import { stdout } from 'node:process';

import type { Image, VersionCombination } from '../config';
import { generateGithubMatrix } from './matrix';

export const runGithubMatrixGenerator = async (
    images: Record<string, Image>,
    directory: string,
    versionCombinations?: VersionCombination<string>[],
): Promise<void> => {
    const entries = generateGithubMatrix(images, directory, versionCombinations);

    console.warn('GitHub Action matrix generated:', JSON.stringify(entries, null, 2));
    stdout.write(JSON.stringify(entries));
};
