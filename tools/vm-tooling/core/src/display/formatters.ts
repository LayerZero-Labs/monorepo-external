import type { VersionCombination } from '../config';
import type { ChainContext } from '../context';
import { getCombinationId } from '../utils';
import { findToolVersionsForCombination } from '../utils/finder';

/**
 * Format version combinations for display
 */
export function formatVersionCombination<TImageId extends string>(
    context: ChainContext<TImageId>,
    combination: VersionCombination<TImageId>,
    isDefault?: boolean,
): string {
    const tools = Object.entries(findToolVersionsForCombination(context, combination))
        .filter(([_, version]) => version !== undefined)
        .map(([tool, version]) => `${tool}:${version}`)
        .join(', ');

    const badges = [
        isDefault ? '🎯 Default' : null,
        combination.stable ? '✅ Stable' : null,
        combination.description,
    ]
        .filter(Boolean)
        .join(' ');

    return `  ${getCombinationId(context, combination)}: ${tools} ${badges}`;
}
