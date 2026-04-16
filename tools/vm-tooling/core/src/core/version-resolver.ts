import * as console from 'node:console';

import type { ChainContext } from '../context';
import { getCombinationId } from '../utils';
import {
    findToolVersionsForCombination,
    getToolDefaultVersion,
    getToolSupportedVersions,
} from '../utils/finder';

/**
 * Resolve versions for all tools in a type with compatibility checking
 */
export const resolveTypeVersions = <TImageId extends string>(
    context: ChainContext<TImageId>,
    userVersions: Record<string, string>,
): Record<string, string> => {
    // Collect versions from all sources for each tool
    const versions: Record<string, string> = {};

    for (const tool of context.tools) {
        const defaultVersion = getToolDefaultVersion(context, tool.name);
        const version = userVersions[tool.name] || defaultVersion;

        if (!version) {
            continue;
        }

        versions[tool.name] = version;

        if (version === defaultVersion) {
            continue;
        }

        // Validate the user-specified version if not default.
        const supportedVersions = getToolSupportedVersions(context, tool.name);

        if (!supportedVersions.includes(version)) {
            console.warn(`⚠️  Version ${version} for ${tool.name} is not in the supported list.`);
            console.warn(`   Supported versions: ${supportedVersions.join(', ')}`);
            console.warn(`   Continuing with Docker availability as final validation...`);
        }
    }

    // Check if current combination matches any compatible combination
    const combination = context.versionCombinations.find((combination) =>
        Object.entries(findToolVersionsForCombination(context, combination)).every(
            ([tool, version]) => versions[tool] === version,
        ),
    );

    if (!combination) {
        throw new Error('Compatible combination of tool versions not found');
    }

    console.info(
        `✅ ${getCombinationId(context, combination)} ${combination.description ? `(${combination.description})` : ''}`,
    );

    return versions;
};
