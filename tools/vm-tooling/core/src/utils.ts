import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { VersionCombination } from './config';
import type { ChainContext } from './context';
import { findToolVersionsForCombination } from './utils/finder';

export const getCombinationId = <TImageId extends string>(
    context: ChainContext<TImageId>,
    combination: VersionCombination<TImageId>,
): string =>
    Object.entries(findToolVersionsForCombination(context, combination))
        .toSorted()
        .flat()
        .join('-');

export const findFileInParentDirectory = async (
    directory: string,
    filename: string,
): Promise<string | null> => {
    while (directory !== dirname(directory)) {
        const path = join(directory, filename);

        try {
            await access(path);
            return path;
        } catch (_) {}

        directory = dirname(directory);
    }

    return null;
};
