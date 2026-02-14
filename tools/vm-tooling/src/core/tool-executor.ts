import { uniqBy } from 'es-toolkit';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import * as semver from 'semver';
import { $, type ProcessOutput } from 'zx';

import type { EnvironmentVariable, VolumeMapping } from '../config';
import type { ChainContext } from '../context';
import { findWorkspaceRoot } from '../utils';
import { getImageUriForTool, getVolumeName } from '../utils/docker';
import { stringifyError } from '../utils/error';
import { findToolByName } from '../utils/finder';
import { lockMany } from './lock';
import { resolveTypeVersions } from './version-resolver';

/**
 * Get the current user's UID and GID for Docker container user matching.
 * This prevents permission issues when containers write to bind-mounted directories.
 * On Windows, returns undefined as UID/GID matching is not needed.
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
 * Resolve host paths in volumes to absolute paths
 * - Paths starting with ~ are resolved to home directory
 * - Relative paths (starting with . or no prefix) are resolved to workspace root
 * - Absolute paths are left unchanged
 */
const resolveVolumePaths = (volumes: VolumeMapping[], workspaceRoot: string): VolumeMapping[] =>
    volumes.map((volume) =>
        volume.type === 'host'
            ? {
                  ...volume,
                  hostPath: path.resolve(
                      workspaceRoot,
                      volume.hostPath.replace(/^~/, os.homedir()),
                  ),
              }
            : volume,
    );

const ensureDockerImage = async (imageUri: string): Promise<void> => {
    let output: ProcessOutput;

    try {
        // Check local images first.
        //
        // NOTE: `docker image ls <ref>` prints repository/tag in separate columns, so
        // `stdout.includes(<full-ref>)` is not reliable. Use `inspect` instead: exitCode=0
        // means the image exists locally.
        // Keep output minimal to avoid dumping full inspect JSON into CI logs.
        output = await $`docker image inspect --format {{.Id}} ${imageUri}`.nothrow();
        if (!output.exitCode) {
            console.info(`✅ Using cached Docker image: ${imageUri}`);
            return;
        }

        console.info('📥 Pulling Docker image from:', imageUri);
        output = await $`docker pull ${imageUri}`.nothrow();
    } catch (error: unknown) {
        throw new Error(`Failed to pull Docker image ${imageUri}: ${stringifyError(error)}`);
    }

    if (output.exitCode) {
        throw new Error(
            [
                'Docker image not available:',
                `  - Image: ${imageUri} (pull failed)`,
                '  - Check if the image tag exists in image registry.',
            ].join('\n'),
        );
    }

    console.info(`✅ Successfully pulled: ${imageUri}`);
};

export interface ToolCommandExecutionOptions {
    cwd: string;
    volumes: readonly VolumeMapping[];
    customEntrypoint?: string;
    env: EnvironmentVariable[];
    script?: string;
    publish?: string;
    versions?: Record<string, string>;
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
    }: ToolCommandExecutionOptions,
): Promise<ProcessOutput> {
    const tool = findToolByName(context, toolName);

    // Merge default volumes with user-specified volumes
    const defaultVolumes = tool.defaultVolumes ?? [];
    const volumes = mergeVolumes(defaultVolumes, userVolumes);

    if (defaultVolumes.length > 0) {
        console.info(`📦 Using ${defaultVolumes.length} default cache volume(s) for ${tool.name}`);
        if (userVolumes.length > 0) {
            const overrides = userVolumes.filter((uv) =>
                defaultVolumes.some((dv) => dv.containerPath === uv.containerPath),
            );
            if (overrides.length > 0) {
                console.info(`🔧 User volumes override ${overrides.length} default volume(s)`);
            }
        }
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

    // Use Docker image with merged volumes
    const imageUri = await getImageUriForTool(context, tool.name, resolvedVersion);
    const workspaceRoot = await findWorkspaceRoot(cwd);
    const relativePath = path.relative(workspaceRoot, cwd);

    await ensureDockerImage(imageUri);

    if (entrypoint?.trim()) {
        console.info(`🔧 Using custom entrypoint: ${entrypoint}`);
    }

    // Merge default env vars with custom env vars (custom takes precedence)
    const defaultEnv = tool.defaultEnv ?? [];

    // Check if Docker socket is mounted (for tools that spawn Docker containers like anchor --verifiable)
    // If so, inject HOST_CWD and HOST_WORKSPACE_ROOT so the inner container knows the host paths
    const hasDockerSocketMount = volumes.some(
        (v) => v.type === 'host' && v.containerPath === '/var/run/docker.sock',
    );
    const dockerSocketEnv: EnvironmentVariable[] = hasDockerSocketMount
        ? [
              { name: 'HOST_CWD', value: cwd },
              { name: 'HOST_WORKSPACE_ROOT', value: workspaceRoot },
          ]
        : [];

    const envArgs = uniqBy(
        [...customEnvVars, ...dockerSocketEnv, ...defaultEnv],
        ({ name }) => name,
    ).flatMap(({ name, value }) => ['-e', `${name}=${value}`]);

    // Add host user UID/GID for permission matching on Linux/macOS
    // This prevents artifacts created in containers from having root ownership
    // Currently only used for stellar which has an entrypoint that handles UID/GID
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
        ...(tool.privileged ? ['--privileged'] : []),
        '--rm',
        ...envArgs,
        ...userIdEnvArgs,
        '-v',
        `${workspaceRoot}:/workspace`,
        '-w',
        `/workspace/${relativePath}`,
        ...(publish ? ['-p', publish.trim()] : []),
        ...resolveVolumePaths(volumes, workspaceRoot).flatMap((volume) => [
            '-v',
            getVolumeName(volume),
        ]),
        ...(entrypoint ? ['--entrypoint', entrypoint] : []),
        imageUri,
        ...finalArgs,
    ];

    const output = await lockMany(
        volumes.flatMap((volume) =>
            volume.type === 'isolate' && volume.locked ? [volume.name] : [],
        ),
        async () => {
            const label = `⏱️ ${finalArgs.join(' ')}`;
            console.time(label);
            const result = await $`docker ${dockerArgs}`.nothrow();
            console.timeEnd(label);

            return result;
        },
    );

    if (output.exitCode) {
        throw new Error(`Failed to run Docker container (exit code: ${output.exitCode})`);
    }

    return output;
}
