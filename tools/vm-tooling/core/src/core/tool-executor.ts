import { uniqBy } from 'es-toolkit';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import * as semver from 'semver';
import { $, type ProcessOutput } from 'zx';

import type { DockerPlatformOverride, EnvironmentVariable, VolumeMapping } from '../config';
import { CARGO_TARGET_CACHE_PATH } from '../config';
import type { ChainContext } from '../context';
import { createMiniWorkspace } from '../mini-workspace';
import {
    type DockerPlatform,
    type DockerPlatformExecution,
    findImageForTool,
    getImageTag,
    getImageUri,
    qualifyVolumeName,
    resolveDockerPlatformExecution,
} from '../utils/docker';
import { stringifyError } from '../utils/error';
import { findToolByName } from '../utils/finder';
import { safeRemove } from '../utils/fs';
import { executeLocally } from './local-executor';
import { lockMany } from './lock';
import { resolveTypeVersions } from './version-resolver';

/**
 * Get the current user's UID and GID for Docker container user matching.
 * This prevents permission issues when containers write to bind-mounted directories.
 * On Windows or when running as root, returns undefined as UID/GID matching is not needed.
 */
const getHostUserIds = (): { uid: number; gid: number } | undefined => {
    // os.userInfo() returns uid/gid on POSIX systems, -1 on Windows
    const userInfo = os.userInfo();
    if (userInfo.uid === -1 || userInfo.gid === -1) {
        return undefined;
    }

    return { uid: userInfo.uid, gid: userInfo.gid };
};

// Configure zx to inherit stdio by default (moved from original setup)
$.verbose = true;
$.stdio = ['inherit', 'pipe', process.stderr];

/**
 * Merge default volumes with user-specified volumes
 * User volumes take precedence when containerPath conflicts
 */
const mergeVolumes = (
    defaultVolumes: readonly VolumeMapping[],
    userVolumes: readonly VolumeMapping[],
): VolumeMapping[] => uniqBy([...userVolumes, ...defaultVolumes], (volume) => volume.containerPath);

/**
 * Merge env layers, highest precedence first. On a name collision the earlier layer wins — so the
 * cache redirect (passed last) can never clobber a user --env or a tool default for the same var.
 */
export const mergeToolEnv = (
    ...layers: readonly (readonly EnvironmentVariable[])[]
): EnvironmentVariable[] => uniqBy(layers.flat(), ({ name }) => name);

// test/nextest/check/clippy, the `t`/`c` aliases, and `cargo test-*`, with an optional +toolchain.
const CACHE_SAFE_CARGO_RE =
    /\bcargo\s+(?:\+\S+\s+)?(?:test|nextest|check|clippy|t|c)(?:\s|$)|\bcargo\s+(?:\+\S+\s+)?test-\S+/;
// Anything that emits host artifacts: cargo build/b, rustc, sbf/bpf (incl. the dashed `cargo-*-sbf`
// binaries the space-anchored branch would miss), and anchor build / idl build / test (anchor test
// compiles the program + IDL before running). `(?![\w-])` ends on a non-word boundary so a
// separator-glued build (`cargo build;`) still trips it.
const CARGO_BUILD_RE =
    /\banchor\s+(?:idl\s+build|build|test)\b|\bcargo-(?:build|test)-(?:sbf|bpf)\b|\bcargo\s+(?:\+\S+\s+)?(?:build(?:-sbf|-bpf)?|b|rustc|test-(?:sbf|bpf))(?![\w-])/;

/**
 * Redirect a cache-safe cargo `--script` to the shared `/cargo-target` mount via CARGO_TARGET_DIR.
 * Skips scripts containing a build (CARGO_BUILD_RE): a build's .so/IDL must reach the host-mounted
 * target/, not the cache. No-ops for tools that don't mount the cache.
 */
export const resolveCargoCacheEnv = (
    script: string | undefined,
    volumes: readonly VolumeMapping[],
): EnvironmentVariable[] => {
    if (!script || !CACHE_SAFE_CARGO_RE.test(script) || CARGO_BUILD_RE.test(script)) {
        return [];
    }

    const cacheVolume = volumes.find(
        (volume) => volume.type === 'isolate' && volume.containerPath === CARGO_TARGET_CACHE_PATH,
    );
    if (!cacheVolume) {
        return [];
    }

    return [{ name: 'CARGO_TARGET_DIR', value: cacheVolume.containerPath }];
};

/**
 * Resolve a host path in a volume to an absolute path.
 * - Paths starting with ~ are resolved to home directory
 * - Relative paths (starting with . or no prefix) are resolved to workspace root
 * - Absolute paths are left unchanged
 */
const resolveVolumePath = (volume: VolumeMapping, workspaceRoot: string): VolumeMapping =>
    volume.type === 'host'
        ? {
              ...volume,
              hostPath: path.resolve(workspaceRoot, volume.hostPath.replace(/^~/, os.homedir())),
          }
        : volume;

const toDockerVolumeArgs = (volume: VolumeMapping): string[] => {
    const mode = volume.readOnly ? ':ro' : '';

    if (volume.type === 'host') {
        return ['-v', `${volume.hostPath}:${volume.containerPath}${mode}`];
    }

    return ['-v', `${volume.name}:${volume.containerPath}${mode}`];
};

const formatDockerArgForDisplay = (arg: string): string =>
    /\s|"/.test(arg) ? `"${arg.replace(/(["\\])/g, '\\$1')}"` : arg;

const formatDockerVolumeArgs = (volumeArgs: readonly (readonly string[])[]): string[] =>
    volumeArgs.map((args) => args.map(formatDockerArgForDisplay).join(' '));

const resolveWorkspaceContainerCwd = async ({
    cwd,
    workspaceRoot,
}: {
    cwd: string;
    workspaceRoot: string;
}): Promise<string> => {
    const cwdReal = await realpath(cwd);
    const relativePath = path.relative(workspaceRoot, cwdReal).split(path.sep).join(path.posix.sep);

    return relativePath ? path.posix.join('/workspace', relativePath) : '/workspace';
};

const ensureDockerImage = async (
    imageUri: string,
    dockerPlatform: DockerPlatformExecution,
): Promise<void> => {
    const platform = dockerPlatform.platform;
    const expectedArchitecture = platform?.arch;
    const docker$ = dockerPlatform.processEnv ? $({ env: dockerPlatform.processEnv }) : $;

    // Probe Docker's runnable platform by creating a container with the requested
    // platform. Docker uses this same platform resolution path for `docker run`.
    //
    // Do not inspect `.ImageManifestDescriptor.platform` here: Docker only added
    // that field in API v1.48 and may still omit it when the daemon does not use a
    // multi-platform image store. `docker image inspect` is also tag/cache-level
    // metadata, not the run-path decision. A successful `container create` is the
    // portable verification signal available without executing the tool command.
    const probeDockerPlatformContainerCreation = async (
        expectedPlatform: DockerPlatform,
    ): Promise<void> => {
        const container =
            await docker$`docker container create --platform ${expectedPlatform.value} ${imageUri} true`
                .nothrow()
                .quiet();

        if (container.exitCode) {
            throw new Error(
                [
                    'Failed to create Docker platform probe container:',
                    `  - Image: ${imageUri}`,
                    `  - Platform: ${expectedPlatform.value}`,
                ].join('\n'),
            );
        }

        const containerId = container.stdout.trim();
        if (!containerId) {
            throw new Error(
                [
                    'Docker platform probe did not return a container id:',
                    `  - Image: ${imageUri}`,
                    `  - Platform: ${expectedPlatform.value}`,
                ].join('\n'),
            );
        }

        await docker$`docker container rm ${containerId}`.nothrow().quiet();
    };

    // NOTE: `docker image ls <ref>` prints repository/tag in separate columns, so
    // `stdout.includes(<full-ref>)` is not reliable. Use `inspect` instead: exitCode=0
    // means the image exists locally.
    // Keep output minimal to avoid dumping full inspect JSON into CI logs.
    //
    // NOTE: Using `.quiet()` to avoid stderr being captured in the CI logs. If the image
    // is not in the cache, the process prints "Error response from daemon: No such image: ..."
    // which can confuse the uninitiated. It's just a cache miss, not an error.
    const localImage = await docker$`docker image inspect --format {{.Architecture}} ${imageUri}`
        .nothrow()
        .quiet();
    if (!localImage.exitCode) {
        const cachedArch = localImage.stdout.trim();
        if (!platform) {
            // No platform was requested, so any locally cached image is acceptable.
            console.info(
                `✅ Using cached Docker image: ${imageUri}${cachedArch ? ` (${cachedArch})` : ''}`,
            );
            return;
        }

        if (cachedArch === expectedArchitecture) {
            // A pinned platform still needs the container probe because tag-level
            // Architecture can disagree with Docker's actual --platform resolution.
            await probeDockerPlatformContainerCreation(platform);
            console.info(`✅ Using cached Docker image: ${imageUri} (${platform.value})`);
            return;
        }

        console.info(
            `🔄 Cached Docker image does not include the requested platform (${platform.value}); re-pulling.`,
        );
    }

    console.info(
        platform
            ? `📥 Pulling Docker image from: ${imageUri} (platform: ${platform.value})`
            : `📥 Pulling Docker image from: ${imageUri}`,
    );
    const output = await docker$`docker pull ${dockerPlatform.args} ${imageUri}`.nothrow();

    if (output.exitCode) {
        const stderr = output.stderr ?? '';
        const isAuthError =
            stderr.includes('authorization token has expired') ||
            stderr.includes('denied') ||
            stderr.includes('pull access denied');

        throw new Error(
            [
                'Docker image not available:',
                `  - Image: ${imageUri} (pull failed)`,
                isAuthError
                    ? '  - ECR auth expired. Run: pnpm localnet login'
                    : '  - Check if the image tag exists in image registry.',
            ].join('\n'),
        );
    }

    // After pulling, verify the same platform resolution path used by `docker run`.
    if (platform) {
        await probeDockerPlatformContainerCreation(platform);
    }

    console.info(`✅ Successfully pulled: ${imageUri}`);
};

export interface ToolCommandExecutionOptions {
    cwd: string;
    volumes: readonly VolumeMapping[];
    customEntrypoint?: string;
    env: EnvironmentVariable[];
    args?: string[];
    script?: string;
    publish?: string[];
    versions?: Record<string, string>;
    defaultVolumesEnabled?: boolean;
    local?: boolean;
    dockerPlatform?: DockerPlatformOverride;
}

/**
 * Enhanced tool command execution using the new version compatibility matrix system
 */
export async function executeToolCommand<TImageId extends string>(
    context: ChainContext<TImageId>,
    toolName: string,
    args: string[],
    {
        cwd,
        volumes: userVolumes,
        customEntrypoint: entrypoint,
        env: customEnvVars,
        script,
        publish,
        versions = {},
        defaultVolumesEnabled = true,
        local,
        dockerPlatform: dockerPlatformOverride,
    }: ToolCommandExecutionOptions,
): Promise<ProcessOutput> {
    const tool = findToolByName(context, toolName);
    const dockerPlatform = resolveDockerPlatformExecution({
        dockerPlatform: dockerPlatformOverride,
        toolDockerPlatform: tool.dockerPlatform,
    });

    // Run pre-execution hook if defined (e.g., toolchain sync)
    // TODO Support a local tool execution.
    if (tool.preExecute) {
        await tool.preExecute(context, {
            cwd,
            args,
            volumes: userVolumes,
            env: customEnvVars,
            script,
            publish,
            versions,
            defaultVolumesEnabled,
            dockerPlatform: dockerPlatformOverride,
        });
    }

    // Get the resolved version for the current tool.
    const resolvedVersion = resolveTypeVersions(context, versions)[tool.name];

    if (!resolvedVersion) {
        throw new Error(`No version resolved for tool ${tool.name}`);
    }

    console.info(`🔧 ${tool.name} version: ${resolvedVersion}`);

    // Check secondary version validation if available
    if (tool.getSecondaryVersion) {
        try {
            const secondaryVersion = await tool.getSecondaryVersion({ cwd });

            if (!semver.satisfies(secondaryVersion, resolvedVersion)) {
                console.warn(
                    `Warning: Local configuration version (${secondaryVersion}) differs from resolved version (${resolvedVersion})`,
                );
            }
        } catch (error) {
            // Secondary version check failed, but continue with resolved version
            console.warn('Could not validate secondary version:', stringifyError(error));
        }
    }

    if (local) {
        return executeLocally(tool, resolvedVersion, {
            cwd,
            args,
            env: customEnvVars,
            script,
        });
    }

    const miniWorkspace = await createMiniWorkspace({
        cwd,
        pruner: tool.miniWorkspacePruner,
    });
    try {
        const workspaceRoot = miniWorkspace.repoRoot;

        const workspaceVolumes: VolumeMapping[] = [
            {
                type: 'host',
                hostPath: miniWorkspace.miniRoot,
                containerPath: '/workspace',
            },
            {
                type: 'host',
                hostPath: miniWorkspace.packageRoot,
                containerPath: `/workspace/${miniWorkspace.packageRelativePath}`,
            },
            {
                type: 'host',
                hostPath: miniWorkspace.pnpmVirtualStoreMount.hostPath,
                containerPath: miniWorkspace.pnpmVirtualStoreMount.containerPath,
                readOnly: miniWorkspace.pnpmVirtualStoreMount.readOnly,
            },
        ];

        const defaultVolumes = defaultVolumesEnabled ? (tool.defaultVolumes ?? []) : [];
        // Names are qualified below, once imageUri (the toolchain key) resolves.
        const resolvedVolumes = mergeVolumes(defaultVolumes, userVolumes).map((volume) =>
            resolveVolumePath(volume, workspaceRoot),
        );

        console.info(`📦 Using mini workspace: ${miniWorkspace.miniRoot}`);
        console.info(
            `📦 Copied ${miniWorkspace.copiedWorkspacePackageCount} workspace package source(s)`,
        );
        if (miniWorkspace.prunerName) {
            console.info(`📦 Mini workspace pruner: ${miniWorkspace.prunerName}`);
        }
        for (const diagnostic of miniWorkspace.diagnostics) {
            console.info(`📦 ${diagnostic}`);
        }

        if (defaultVolumes.length > 0) {
            console.info(`📦 Using ${defaultVolumes.length} default volume(s) for ${tool.name}`);

            if (userVolumes.length > 0) {
                const overrides = userVolumes.filter((userVolume) =>
                    defaultVolumes.some(
                        (defaultVolume) => defaultVolume.containerPath === userVolume.containerPath,
                    ),
                );

                if (overrides.length > 0) {
                    console.info(`🔧 User volumes override ${overrides.length} default volume(s)`);
                }
            }
        }

        // Use Docker image with merged volumes
        const image = findImageForTool(context, tool.name, resolvedVersion);
        const imageUri = await getImageUri(image);
        const containerCwd = await resolveWorkspaceContainerCwd({ cwd, workspaceRoot });

        // The image tag keys toolchain-shared caches — it's the registry identity of the pulled image,
        // so artifacts compiled inside it can't bleed across toolchains. See qualifyVolumeName.
        const cacheKey = getImageTag(image);
        const qualifiedVolumes = resolvedVolumes.map((volume) =>
            qualifyVolumeName(volume, { ...dockerPlatform.volumeNameOptions, cacheKey }),
        );
        const volumeArgs = [
            ...workspaceVolumes.map(toDockerVolumeArgs),
            ...qualifiedVolumes.map(toDockerVolumeArgs),
        ];

        console.info('📦 Docker volumes:');
        for (const volumeArg of formatDockerVolumeArgs(volumeArgs)) {
            console.info(`  ${volumeArg}`);
        }

        await ensureDockerImage(imageUri, dockerPlatform);

        if (entrypoint?.trim()) {
            console.info(`🔧 Using custom entrypoint: ${entrypoint}`);
        }

        // Merge default env vars with custom env vars (custom takes precedence)
        const defaultEnv = tool.defaultEnv ?? [];

        // Check if Docker socket is mounted (for tools that spawn Docker containers like anchor --verifiable)
        // If so, inject HOST_CWD and HOST_WORKSPACE_ROOT so the inner container knows the host paths
        const hasDockerSocketMount = resolvedVolumes.some(
            (volume) => volume.type === 'host' && volume.containerPath === '/var/run/docker.sock',
        );
        const dockerSocketEnv: EnvironmentVariable[] = hasDockerSocketMount
            ? [
                  { name: 'HOST_CWD', value: cwd },
                  { name: 'HOST_WORKSPACE_ROOT', value: workspaceRoot },
              ]
            : [];

        // Lowest precedence (passed last) so a user --env or tool default for CARGO_TARGET_DIR wins.
        const cargoCacheEnv = resolveCargoCacheEnv(script, resolvedVolumes);

        const envArgs = mergeToolEnv(
            customEnvVars,
            dockerSocketEnv,
            defaultEnv,
            cargoCacheEnv,
        ).flatMap(({ name, value }) => ['-e', `${name}=${value}`]);

        if (cargoCacheEnv.length > 0) {
            console.info(`🗃️  Sharing cargo target cache at ${CARGO_TARGET_CACHE_PATH}`);
        }

        // Add host user UID/GID for permission matching on Linux/macOS
        // This prevents artifacts created in containers from having root ownership
        // Used by stellar, sui, and iota images which have an entrypoint that handles UID/GID
        const hostUserIds = getHostUserIds();
        const userIdEnvArgs = hostUserIds
            ? ['-e', `LOCAL_UID=${hostUserIds.uid}`, '-e', `LOCAL_GID=${hostUserIds.gid}`]
            : [];

        console.info(`👤 Running container as UID:GID ${hostUserIds?.uid}:${hostUserIds?.gid}`);

        if (defaultEnv.length > 0) {
            console.info(
                `🌍 Using ${defaultEnv.length} default environment variable(s) for ${tool.name}`,
            );
        }
        if (customEnvVars.length > 0) {
            console.info(`🌍 Using ${customEnvVars.length} custom environment variable(s)`);
        }

        // Handle custom script execution
        let finalArgs: string[];
        if (script && script.trim() !== '') {
            console.info(`📜 Executing custom script: ${script}`);
            finalArgs = ['bash', '-c', script];
        } else {
            finalArgs = entrypoint === undefined ? [tool.name, ...args] : args;
        }

        // Build the Docker command with proper argument separation
        const dockerArgs = [
            'run',
            ...dockerPlatform.args,
            ...(tool.privileged ? ['--privileged'] : []),
            '--rm',
            '--add-host=host.docker.internal:host-gateway',
            ...envArgs,
            ...userIdEnvArgs,
            ...volumeArgs.flat(),
            '-w',
            containerCwd,
            ...(publish ?? []).flatMap((p) => ['-p', p.trim()]),
            ...(entrypoint ? ['--entrypoint', entrypoint] : []),
            imageUri,
            ...finalArgs,
        ];

        const output = await lockMany(
            qualifiedVolumes.flatMap((volume) =>
                volume.type === 'isolate' && volume.locked ? [volume.name] : [],
            ),
            async () => {
                const label = `⏳ ${finalArgs.join(' ')}`;
                console.time(label);
                const docker$ = dockerPlatform.processEnv
                    ? $({ env: dockerPlatform.processEnv })
                    : $;
                const result = await docker$`docker ${dockerArgs}`.nothrow();
                console.timeEnd(label);

                return result;
            },
        );

        if (output.exitCode) {
            const stdout = output.stdout.trim();
            throw new Error(
                `Failed to run Docker container (exit code: ${output.exitCode})${stdout ? `\n${stdout}` : ''}`,
            );
        }

        return output;
    } finally {
        // Docker can release bind mounts slightly after the command exits; cleanup failures should
        // not fail a completed tool run.
        const removeResult = await safeRemove(miniWorkspace.miniRoot);
        if (!removeResult.removed) {
            console.warn(
                `⚠️  Failed to clean up mini workspace ${miniWorkspace.miniRoot}: ${stringifyError(removeResult.error)}`,
            );
        }
    }
}
