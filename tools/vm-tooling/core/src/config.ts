import { join } from 'node:path';
import * as z from 'zod';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

import type { ChainContext } from './context';
import type { ToolCommandExecutionOptions } from './core/tool-executor';
import * as environment from './environment';
import type { MiniWorkspacePruner } from './mini-workspace';

interface RegistryConfig {
    registry: string;
    imageDirectory: string;
}

let registryConfigCache: RegistryConfig | undefined;

const getRegistryConfig = async (): Promise<RegistryConfig> => {
    if (!registryConfigCache) {
        if (environment.registry && environment.imageDirectory) {
            registryConfigCache = {
                registry: environment.registry,
                imageDirectory: environment.imageDirectory,
            };
        } else {
            const workspaceRoot = await getFullyQualifiedRepoRootPath();
            const configPath = join(
                workspaceRoot,
                'configs',
                'vm-tooling',
                'values',
                'docker-image-repo.ts',
            );

            const module = await import(configPath);
            registryConfigCache = module.default;
        }
    }
    return registryConfigCache!;
};

// Container path for the shared cargo build-artifact cache. A VM mounts its toolchain `target/`
// cache at this path; resolveCargoCacheEnv keys on it to inject CARGO_TARGET_DIR. Single source so
// the helper's lookup and each VM config's containerPath can't drift apart.
export const CARGO_TARGET_CACHE_PATH = '/cargo-target';

const volumeMappingBaseSchema = z.object({
    containerPath: z.string(),
    readOnly: z.optional(z.boolean()),
});

const hostVolumeMappingSchema = volumeMappingBaseSchema.extend({
    type: z.literal('host'),
    hostPath: z.string(),
});

const isolateVolumeMappingSchema = volumeMappingBaseSchema.extend({
    type: z.literal('isolate'),
    name: z.string(),
    shared: z.optional(z.boolean()),
    locked: z.optional(z.boolean()),
    // Share this cache across packages on the same toolchain instead of per-package. See
    // qualifyVolumeName. Opt-in — omit to keep it package-private.
    toolchainKeyed: z.optional(z.boolean()),
    // Opt out of arch-namespacing for volumes holding no compiled artifacts (config/state).
    // Suffixing is the safe default: under-splitting an arch-sensitive cache poisons it.
    architectureIndependent: z.optional(z.boolean()),
});

export const volumeMappingSchema = z.union([hostVolumeMappingSchema, isolateVolumeMappingSchema]);

export type VolumeMapping = z.infer<typeof volumeMappingSchema>;

export interface EnvironmentVariable {
    name: string;
    value: string;
}

// Explicit platform pins currently supported by tool config and the CLI.
// `native` is a CLI-only escape hatch that runs Docker without `--platform`
// and clears DOCKER_DEFAULT_PLATFORM for that invocation.
export const DOCKER_PLATFORM_VALUES = ['linux/amd64', 'linux/arm64'] as const;
export const DOCKER_PLATFORM_NATIVE = 'native';
export const DOCKER_PLATFORM_OVERRIDE_VALUES = [
    DOCKER_PLATFORM_NATIVE,
    ...DOCKER_PLATFORM_VALUES,
] as const;
export const DOCKER_PLATFORM_OVERRIDE_VALUES_DESCRIPTION =
    DOCKER_PLATFORM_OVERRIDE_VALUES.join(', ');

const dockerPlatformOverrideValueSet = new Set<string>(DOCKER_PLATFORM_OVERRIDE_VALUES);

export type DockerPlatformValue = (typeof DOCKER_PLATFORM_VALUES)[number];
export type DockerPlatformOverride = (typeof DOCKER_PLATFORM_OVERRIDE_VALUES)[number];

export const isDockerPlatformOverride = (input: unknown): input is DockerPlatformOverride =>
    typeof input === 'string' && dockerPlatformOverrideValueSet.has(input);

export interface Tool {
    name: string;
    privileged?: boolean;

    // Docker platform to use when running this tool's image
    dockerPlatform?: DockerPlatformValue;

    // Default isolate volumes for caching (user volumes can override these)
    defaultVolumes?: readonly VolumeMapping[];

    // Default environment variables (user env vars can override these)
    defaultEnv?: readonly EnvironmentVariable[];

    // Optional VM-specific mini-workspace pruning/validation hook.
    miniWorkspacePruner?: MiniWorkspacePruner;

    // Optional version parsing and validation functions
    getSecondaryVersion?: (args: { cwd: string }) => Promise<string>;

    getLocalVersion?: (args: { cwd: string }) => Promise<string>;

    // Optional hook called before every tool command execution (e.g., toolchain sync)
    preExecute?: (
        context: ChainContext<string>,
        options: ToolCommandExecutionOptions,
    ) => Promise<void>;
}

export const enum DockerRegistryMirror {
    PUBLIC_GAR = 'public-gar',
}

export interface Image {
    name: string;
    versions: Record<string, string>;
    dependencies?: Record<string, string>;
    patch?: number;
    mirrorRegistries?: DockerRegistryMirror[];
}

export interface VersionCombination<TImageId> {
    images: Record<string, TImageId>;
    description?: string;
    stable?: boolean;
}

export const getImageDirectory = async () => (await getRegistryConfig()).imageDirectory;
export const getRegistry = async () => (await getRegistryConfig()).registry;
