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

export const generateGithubMatrix = (
    images: Record<string, Image>,
    directory: string,
    versionCombinations?: VersionCombination<string>[],
): GithubMatrixOutput => {
    const createImageEntry = ([imageId, image]: [string, Image]): {
        entry: ImageEntry;
        image: Image;
    } => {
        const tag = getImageTag(image);

        if (!tag) {
            throw new Error(
                `Image "${imageId}" produced no tags. Every image must have at least one non-empty tag.`,
            );
        }

        return {
            entry: {
                id: imageId,
                name: image.name,
                build_args: Object.entries({ ...image.versions, ...image.dependencies })
                    .sort()
                    .map(([key, value]) => `${constantCase(key)}_VERSION=${value}`),
                directory: join(directory, 'docker', image.name),
                image_name: getImageName(image.name),
                tags: [tag],
            },
            image,
        };
    };

    const results = Object.entries(images).map(createImageEntry);

    const imageEntries = results.map((r) => r.entry);

    const mirroredImages = results
        .filter((result) => result.image.mirrorRegistries?.length)
        .flatMap(({ entry, image }) =>
            image.mirrorRegistries!.map((mirror) => ({
                id: entry.id,
                name: entry.name,
                image_name: entry.image_name,
                tags: entry.tags,
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
