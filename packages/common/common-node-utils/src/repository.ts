import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { env } from 'node:process';
import { fileURLToPath } from 'node:url';

const packageDirectory = dirname(fileURLToPath(import.meta.url));

const getPath = async (): Promise<string> => {
    if (env.REPO_ROOT) {
        return env.REPO_ROOT;
    }

    let directory = packageDirectory;

    while (true) {
        try {
            await access(join(directory, 'pnpm-workspace.yaml'));
            return directory;
        } catch {
            const parent = dirname(directory);

            if (parent === directory) {
                throw new Error(
                    `Could not locate root (pnpm-workspace.yaml not found. started from ${packageDirectory}, ended at ${directory})`,
                );
            }

            directory = parent;
        }
    }
};

let cache: Promise<string> | undefined;

/**
 * The fully qualified path to the repository root by searching for pnpm-workspace.yaml
 * @returns The absolute path to the repository root
 */
export const getFullyQualifiedRepoRootPath = (): Promise<string> => {
    cache ??= getPath();
    return cache;
};
