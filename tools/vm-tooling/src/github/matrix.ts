import { constantCase } from 'es-toolkit';
import { join } from 'node:path';

import { type Image, type VersionCombination } from '../config';
import { getImageTag } from '../utils/docker';
import { getImageName } from '../utils/finder';

interface ImageEntry {
    id: string;
    name: string;
    build_args: string[];
    image_name: string;
    tags: string[];
    directory: string;
}

interface MirroredImageEntry {
    id: string;
    name: string;
    image_name: string;
    tags: string[];
    mirror: string;
}

interface GithubMatrixOutput {
    images: ImageEntry[];
    mirroredImages: MirroredImageEntry[];
    activeImages: string[];
}

// TODO Remove underscore which is not standard in the Docker tag naming scheme.
const TAG_SEPARATORS = ['-', '_'] as const;

export const generateGithubMatrix = (
    images: Record<string, Image>,
    directory: string,
    versionCombinations?: VersionCombination<string>[],
): GithubMatrixOutput => {
    const createImageEntry = ([imageId, image]: [string, Image]): {
        entry: ImageEntry;
        image: Image;
    } => {
        const imageName = getImageName(image.name);
        const tags = TAG_SEPARATORS.map((separator) => getImageTag(image, separator));

        return {
            entry: {
                id: imageId,
                name: image.name,
                build_args: Object.entries({ ...image.versions, ...image.dependencies })
                    .sort()
                    .map(([key, value]) => `${constantCase(key)}_VERSION=${value}`),
                directory: join(directory, 'docker', image.name),
                image_name: imageName,
                tags,
            },
            image,
        };
    };

    const results = Object.entries(images).map(createImageEntry);

    const imageEntries = results.map((r) => r.entry);

    const mirroredImages = results
        .filter((result) => result.image.mirrorRegistries?.length)
        .flatMap((result) =>
            result.image.mirrorRegistries!.map((mirror) => ({
                id: result.entry.id,
                name: result.entry.name,
                image_name: result.entry.image_name,
                tags: result.entry.tags,
                mirror,
            })),
        );

    const activeImages: string[] = [];
    if (versionCombinations) {
        const activeImageIds = new Set(
            versionCombinations.flatMap((combo) => Object.values(combo.images)),
        );
        activeImages.push(...activeImageIds);
    }

    return { images: imageEntries, mirroredImages, activeImages };
};
