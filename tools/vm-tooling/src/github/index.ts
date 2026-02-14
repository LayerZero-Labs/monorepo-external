import { stdout } from 'node:process';

import type { Image } from '../config';
import { generateGithubMatrix } from './matrix';

export const runGithubMatrixGenerator = async (
    images: Record<string, Image>,
    directory: string,
): Promise<void> => {
    const entries = generateGithubMatrix(images, directory);

    console.warn('GitHub Action matrix generated:', JSON.stringify(entries, null, 2));
    stdout.write(JSON.stringify(entries));
};
