import { basename, join } from 'node:path';
import { env } from 'node:process';

import type { Image, VolumeMapping } from '../config';
import { getImageDirectory, getRegistry } from '../config';
import type { ChainContext } from '../context';
import { findToolVersionsForCombination, getImageName } from './finder';

export const getImageUriForTool = async <TImageId extends string>(
    context: ChainContext<TImageId>,
    toolName: string,
    version: string,
    separator: '_' | '-' = '_',
): Promise<string> => {
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

    return getImageUri(image, separator);
};

export const getImageUri = async (image: Image, separator: '_' | '-' = '_'): Promise<string> =>
    join(
        await getRegistry(),
        await getImageDirectory(),
        `${getImageName(image.name)}:${getImageTag(image, separator)}`,
    );

export const getImageTag = ({ versions, patch }: Image, separator: '_' | '-' = '_'): string =>
    [...Object.entries(versions).sort().flat(), ...(patch ? ['patch', patch] : [])].join(separator);

export const qualifyVolumeName = (volume: VolumeMapping): VolumeMapping => {
    if (volume.type !== 'isolate') {
        return volume;
    }

    const components = ['lz-tooling-cache', volume.name];

    if (!volume.shared) {
        // This is the package name where the `lz-tool` command is executed.
        const packageName = env.npm_package_name;

        if (!packageName) {
            throw new Error('npm_package_name environment variable not defined');
        }

        components.push(basename(packageName));
    }

    return { ...volume, name: components.join('-') };
};
