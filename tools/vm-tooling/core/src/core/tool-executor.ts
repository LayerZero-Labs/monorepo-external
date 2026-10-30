import { uniqBy } from 'es-toolkit';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import * as semver from 'semver';
import { $, type ProcessOutput } from 'zx';

import type { DockerPlatformOverride, EnvironmentVariable, VolumeMapping } from '../config';
import { CARGO_TARGET_CACHE_PATH } from '../config';
import type { ChainContext } from '../context';
import { createScopedWorkspace } from '../scoped-workspace';
import {
    type DockerCommandRunner,
    type DockerProcessEnv,
    findImageForTool,
    getImageTag,
    getImageUri,
    qualifyVolumeName,
    resolveDockerPlatform,
    resolveRunDockerPlatform,
} from '../utils/docker';
import { stringifyError } from '../utils/error';
import { findToolByName } from '../utils/finder';
import { safeRemove } from '../utils/fs';
import { ensureDockerImage } from './docker-image';
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
 * cargo cache env (passed last) can never clobber a user --env or a tool default for the same var.
 */
export const mergeToolEnv = (
    ...layers: readonly (readonly EnvironmentVariable[])[]
): EnvironmentVariable[] => uniqBy(layers.flat(), ({ name }) => name);

/**
 * Point cargo's build-dir (intermediate artifacts) into the tool's `/cargo-target` cache volume,
 * one subtree per host checkout and cargo workspace. Final artifacts (`.so`, IDL, keypairs) land in
 * the package's host-mounted `target/`. No-ops for tools that don't mount the cache.
 *
 * Build-script `OUT_DIR`s live in the build-dir, outside the cwd that cargo-build-sbf remaps. A
 * program that embeds an `OUT_DIR` path (e.g. a panic inside
 * `include!(concat!(env!("OUT_DIR"), ...))`) gets a per-checkout path in its bytecode.
 *
 * Per checkout because every checkout mounts a package at the same `/workspace/<rel>` path, and
 * cargo keys path crates by name, version and workspace-relative path: two checkouts (or two
 * packages with a same-named crate at the same relative path) sharing one dir silently reuse each
 * other's artifacts. `{workspace-path-hash}` separates workspaces within a checkout.
 *
 * Cargo versions without build-dir support ignore both variables and build in `target/`.
 */
export const resolveCargoBuildDirEnv = (
    volumes: readonly VolumeMapping[],
    checkoutRoot: string,
): EnvironmentVariable[] => {
    const cacheVolume = volumes.find(
        (volume) => volume.type === 'isolate' && volume.containerPath === CARGO_TARGET_CACHE_PATH,
    );
    if (!cacheVolume) {
        return [];
    }

    const checkoutKey = createHash('sha256').update(checkoutRoot).digest('hex').slice(0, 16);

    return [
        {
            name: 'CARGO_BUILD_BUILD_DIR',
            value: path.posix.join(cacheVolume.containerPath, checkoutKey, '{workspace-path-hash}'),
        },
        // build-dir is stable from cargo 1.91; the platform-tools v1.52 cargo (1.89-dev) needs the opt-in.
        { name: 'CARGO_UNSTABLE_BUILD_DIR', value: 'true' },
    ];
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
    const options = [
        ...(volume.readOnly ? ['ro'] : []),
        ...(volume.type === 'isolate' && volume.nocopy ? ['nocopy'] : []),
    ];
    const mode = options.length > 0 ? `:${options.join(',')}` : '';

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

const createDockerCommandRunner =
    (processEnv?: DockerProcessEnv): DockerCommandRunner =>
    async (args, { isQuiet = true } = {}) => {
        const docker$ = $({
            stdio: ['inherit', 'pipe', 'pipe'],
            ...(processEnv ? { env: processEnv } : {}),
        });
        const command = docker$`docker ${[...args]}`.nothrow();
        const { exitCode, stdout, stderr } = await (isQuiet ? command.quiet() : command);

        return { exitCode, stdout, stderr };
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

    const { execution: dockerPlatform, engine } = await resolveRunDockerPlatform({
        dockerPlatform: dockerPlatformOverride,
        toolDockerPlatform: tool.dockerPlatform,
        docker: createDockerCommandRunner(),
    });
    if (dockerPlatform.notice) {
        console.warn(dockerPlatform.notice);
    }

    const scopedWorkspace = await createScopedWorkspace({
        cwd,
        pruner: tool.scopedWorkspacePruner,
    });
    try {
        const workspaceRoot = scopedWorkspace.repoRoot;

        const workspaceVolumes: VolumeMapping[] = [
            {
                type: 'host',
                hostPath: scopedWorkspace.scopedRoot,
                containerPath: '/workspace',
            },
            {
                type: 'host',
                hostPath: scopedWorkspace.packageRoot,
                containerPath: `/workspace/${scopedWorkspace.packageRelativePath}`,
            },
            {
                type: 'host',
                hostPath: scopedWorkspace.pnpmVirtualStoreMount.hostPath,
                containerPath: scopedWorkspace.pnpmVirtualStoreMount.containerPath,
                readOnly: scopedWorkspace.pnpmVirtualStoreMount.readOnly,
            },
        ];

        const defaultVolumes = defaultVolumesEnabled ? (tool.defaultVolumes ?? []) : [];
        // Names are qualified below, once imageUri (the toolchain key) resolves.
        const resolvedVolumes = mergeVolumes(defaultVolumes, userVolumes).map((volume) =>
            resolveVolumePath(volume, workspaceRoot),
        );

        console.info(`📦 Using scoped workspace: ${scopedWorkspace.scopedRoot}`);
        console.info(
            `📦 Copied ${scopedWorkspace.copiedWorkspacePackageCount} workspace package source(s)`,
        );
        if (scopedWorkspace.prunerName) {
            console.info(`📦 Scoped workspace pruner: ${scopedWorkspace.prunerName}`);
        }
        for (const diagnostic of scopedWorkspace.diagnostics) {
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

        const imageRef = await ensureDockerImage({
            imageUri,
            platform: dockerPlatform.platform,
            pinnedPlatform: resolveDockerPlatform(tool.dockerPlatform),
            docker: createDockerCommandRunner(dockerPlatform.processEnv),
            engine,
        });

        if (entrypoint?.trim()) {
            console.info(`🔧 Using custom entrypoint: ${entrypoint}`);
        }

        // Merge default env vars with custom env vars (custom takes precedence)
        const defaultEnv = tool.defaultEnv ?? [];

        // Check if Docker socket is mounted (for tools that spawn Docker containers)
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

        // Lowest precedence (passed last) so a user --env or tool default for the same var wins.
        const cargoCacheEnv = resolveCargoBuildDirEnv(resolvedVolumes, workspaceRoot);

        const envArgs = mergeToolEnv(
            customEnvVars,
            dockerSocketEnv,
            defaultEnv,
            cargoCacheEnv,
        ).flatMap(({ name, value }) => ['-e', `${name}=${value}`]);

        if (cargoCacheEnv.length > 0) {
            console.info(`🗃️  Cargo build-dir in cache volume at ${CARGO_TARGET_CACHE_PATH}`);
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
            imageRef,
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
        const removeResult = await safeRemove(scopedWorkspace.scopedRoot);
        if (!removeResult.removed) {
            console.warn(
                `⚠️  Failed to clean up scoped workspace ${scopedWorkspace.scopedRoot}: ${stringifyError(removeResult.error)}`,
            );
        }
    }
}
