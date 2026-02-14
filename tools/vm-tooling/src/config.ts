import { join } from 'node:path';
import * as z from 'zod';

import { getFullyQualifiedRepoRootPath } from '@layerzerolabs/common-node-utils';

interface RegistryConfig {
    registry: string;
    imageDirectory: string;
}

let registryConfigCache: RegistryConfig | undefined;

const getRegistryConfig = async (): Promise<RegistryConfig> => {
    if (!registryConfigCache) {
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        const envRegistry = process.env.VM_TOOLING_REGISTRY;
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        const envImageDirectory = process.env.VM_TOOLING_IMAGE_DIRECTORY;

        if (envRegistry && envImageDirectory) {
            registryConfigCache = { registry: envRegistry, imageDirectory: envImageDirectory };
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

const volumeMappingBaseSchema = z.object({
    containerPath: z.string(),
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
});

export const volumeMappingSchema = z.union([hostVolumeMappingSchema, isolateVolumeMappingSchema]);

export type VolumeMapping = z.infer<typeof volumeMappingSchema>;

export interface EnvironmentVariable {
    name: string;
    value: string;
}

export interface Tool {
    name: string;
    privileged?: boolean;

    // Default isolate volumes for caching (user volumes can override these)
    defaultVolumes?: readonly VolumeMapping[];

    // Default environment variables (user env vars can override these)
    defaultEnv?: readonly EnvironmentVariable[];

    // Optional version parsing and validation functions
    getSecondaryVersion?: (args: { cwd: string }) => Promise<string>;
}

export enum DockerRegistryMirror {
    PUBLIC_GAR = 'public-gar',
}

export interface Image {
    name: string;
    versions: Record<string, string>;
    dependencies?: Record<string, string>;
    patch?: number;
    unreleased?: boolean;
    mirrorRegistries?: DockerRegistryMirror[];
}

export interface VersionCombination<TImageId> {
    images: Record<string, TImageId>;
    description?: string;
    stable?: boolean;
}

export const getImageDirectory = async () => (await getRegistryConfig()).imageDirectory;
export const getRegistry = async () => (await getRegistryConfig()).registry;
