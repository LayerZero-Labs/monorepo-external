import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { VersionCombination } from './config';
import type { ChainContext } from './context';
import { findToolVersionsForCombination } from './utils/finder';

// TODO Add more root markers when we publish the VM tooling package.
const rootFiles: string[] = ['pnpm-workspace.yaml', '.git'];

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

export const findWorkspaceRoot = async (directory: string): Promise<string> => {
    for (const rootFile of rootFiles) {
        const path = await findFileInParentDirectory(directory, rootFile);

        if (path) {
            return dirname(path);
        }
    }

    throw new Error(`Workspace root not found from directory: ${directory}`);
};
