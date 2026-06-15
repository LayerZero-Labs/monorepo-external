import { basename, join } from 'node:path';
import { env } from 'node:process';

import type { DockerPlatformOverride, DockerPlatformValue, Image, VolumeMapping } from '../config';
import { DOCKER_PLATFORM_NATIVE, getImageDirectory, getRegistry } from '../config';
import type { ChainContext } from '../context';
import { findToolVersionsForCombination, getImageName } from './finder';

export interface DockerPlatform {
    /** Raw value, e.g. `linux/amd64`, for Docker `--platform`. */
    value: string;
    /** Filesystem-safe token for cache volume names, e.g. `linux-amd64`. */
    namespace: string;
    /** Architecture as `docker inspect --format {{.Architecture}}` reports it, e.g. `amd64`. */
    arch: string;
}

export type DockerProcessEnv = Record<string, string | undefined>;

export interface QualifyVolumeNameOptions {
    cacheKey?: string;
    dockerPlatform?: string;
}

export interface DockerPlatformResolutionOptions {
    dockerPlatform?: DockerPlatformOverride;
    toolDockerPlatform?: DockerPlatformValue;
    envDockerPlatform?: string;
}

export interface DockerPlatformExecution {
    platform?: DockerPlatform;
    args: string[];
    processEnv?: DockerProcessEnv;
    volumeNameOptions: QualifyVolumeNameOptions;
}

export const resolveDockerPlatform = (dockerPlatform?: string): DockerPlatform | undefined => {
    if (!dockerPlatform) {
        return undefined;
    }

    const [, archSegment] = dockerPlatform.split('/');
    const arch = archSegment || dockerPlatform;

    return {
        value: dockerPlatform,
        namespace: dockerPlatform.replace(/\//g, '-'),
        arch,
    };
};

// Platform precedence is intentional: CLI override > tool default > DOCKER_DEFAULT_PLATFORM.
// A tool default is an explicit choice made by the tool config (for example Anchor's amd64 pin),
// so a user's shell env should not override it by accident. DOCKER_DEFAULT_PLATFORM only applies
// when the tool does not declare a platform.
// `native` is an escape hatch from forced platform selection: it resolves to no
// platform value, so Docker commands run without `--platform`.
export const resolveEffectiveDockerPlatformValue = ({
    dockerPlatform,
    toolDockerPlatform,
    envDockerPlatform = env.DOCKER_DEFAULT_PLATFORM,
}: DockerPlatformResolutionOptions): string | undefined => {
    if (dockerPlatform === DOCKER_PLATFORM_NATIVE) {
        return undefined;
    }

    return dockerPlatform ?? toolDockerPlatform ?? envDockerPlatform;
};

export const resolveDockerPlatformExecution = (
    options: DockerPlatformResolutionOptions,
): DockerPlatformExecution => {
    if (options.dockerPlatform === DOCKER_PLATFORM_NATIVE) {
        // Clear DOCKER_DEFAULT_PLATFORM as well, otherwise Docker would still be forced
        // to use that platform even though this run requested native execution.
        const { DOCKER_DEFAULT_PLATFORM: _dockerDefaultPlatform, ...processEnv } = env;

        return {
            args: [],
            processEnv,
            volumeNameOptions: { dockerPlatform: undefined },
        };
    }

    const platform = resolveDockerPlatform(resolveEffectiveDockerPlatformValue(options));

    return {
        platform,
        args: platform ? ['--platform', platform.value] : [],
        volumeNameOptions: { dockerPlatform: platform?.value },
    };
};

export const findImageForTool = <TImageId extends string>(
    context: ChainContext<TImageId>,
    toolName: string,
    version: string,
): Image => {
    const [image] = context.versionCombinations.flatMap((combination) => {
        const imageId = combination.images[toolName];

        if (!imageId) {
            return [];
        }

        const image = context.images[imageId];

        return image && findToolVersionsForCombination(context, combination)[toolName] === version
            ? [image]
            : [];
    });

    if (!image) {
        throw new Error(
            `No version combination found for tool ${toolName} with version ${version}`,
        );
    }

    return image;
};

export const getImageUri = async (image: Image): Promise<string> =>
    join(
        await getRegistry(),
        await getImageDirectory(),
        `${getImageName(image.name)}:${getImageTag(image)}`,
    );

export const getImageTag = ({ versions, patch }: Image): string =>
    [...Object.entries(versions).sort().flat(), ...(patch ? ['patch', patch] : [])].join('-');

export const qualifyVolumeName = (
    volume: VolumeMapping,
    { cacheKey, dockerPlatform }: QualifyVolumeNameOptions = {
        dockerPlatform: env.DOCKER_DEFAULT_PLATFORM,
    },
): VolumeMapping => {
    if (volume.type !== 'isolate') {
        return volume;
    }

    const components = ['lz-tooling-cache', volume.name];

    if (!volume.shared) {
        // Opted-in volumes key on the toolchain (image tag) so same-toolchain packages share one
        // cache; the rest stay package-private. Falls back to package-private without a cacheKey.
        if (volume.toolchainKeyed && cacheKey) {
            components.push(cacheKey);
        } else {
            const packageName = env.npm_package_name;

            if (!packageName) {
                throw new Error('npm_package_name environment variable not defined');
            }

            components.push(basename(packageName));
        }
    }

    const platform = resolveDockerPlatform(dockerPlatform);
    if (platform && !volume.architectureIndependent) {
        components.push(platform.namespace);
    }

    return { ...volume, name: components.join('-') };
};
