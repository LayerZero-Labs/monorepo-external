import { isString } from 'es-toolkit';

import type { VersionCombination } from '../config';
import type { Tool } from '../config';
import type { ChainContext } from '../context';

export const findToolByName = <TImageId extends string>(
    { tools }: ChainContext<TImageId>,
    toolName: string,
): Tool => {
    const tool = tools.find((tool) => tool.name === toolName);

    if (!tool) {
        throw new Error(`Tool '${toolName}' not found`);
    }

    return tool;
};

export const getImageName = (basename: string): string => `${basename}-tooling`;

/**
 * Get default version for a specific tool from version matrix
 */
export const getToolDefaultVersion = <TImageId extends string>(
    context: ChainContext<TImageId>,
    toolName: string,
): string | null => {
    const combination = context.versionCombinations[0];

    if (!combination) {
        return null;
    }

    const version = findToolVersionsForCombination(context, combination)[toolName];

    if (!version) {
        console.warn(`No default version found for tool '${toolName}' in matrix`);
        return null;
    }

    return version;
};

export const findToolVersionsForCombination = <TImageId extends string>(
    { images }: ChainContext<TImageId>,
    combination: VersionCombination<TImageId>,
): Record<string, string> =>
    Object.fromEntries(
        Object.entries(combination.images).map(([tool, imageId]) => {
            const version = images[imageId].versions[tool];

            if (!version) {
                throw new Error(`Tool ${tool} not found in Docker image: ${imageId}`);
            }

            return [tool, version];
        }),
    );

/**
 * Get supported versions for a specific tool from version matrix
 */
export const getToolSupportedVersions = <TImageId extends string>(
    context: ChainContext<TImageId>,
    toolName: string,
): string[] =>
    [
        ...new Set(
            context.versionCombinations
                .map(
                    (combination) => findToolVersionsForCombination(context, combination)[toolName],
                )
                .filter(isString),
        ),
    ].sort();
