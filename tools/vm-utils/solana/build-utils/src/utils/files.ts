import * as fs from 'fs/promises';
import { stat } from 'node:fs/promises';
import path from 'path';

/**
 * Check if a path exists in the filesystem
 * @param path - The path to check
 * @returns true if the path exists, false otherwise
 */
export async function pathExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch (err: any) {
        return err.code !== 'ENOENT' ? true : false;
    }
}

let _fullyQualifiedRepoRootPath: Promise<string> | undefined = undefined;
/**
 * Get the fully qualified path to the repository root by searching for pnpm-workspace.yaml
 * @returns The absolute path to the repository root
 *
 * Duplicated from common-node-utils to optimize turbo cache
 */
export const getFullyQualifiedRepoRootPath = (): Promise<string> => {
    if (!_fullyQualifiedRepoRootPath) {
        // eslint-disable-next-line turbo/no-undeclared-env-vars
        if (process.env.REPO_ROOT) {
            // eslint-disable-next-line turbo/no-undeclared-env-vars
            _fullyQualifiedRepoRootPath = Promise.resolve(process.env.REPO_ROOT);
        } else {
            _fullyQualifiedRepoRootPath = (async (): Promise<string> => {
                let currentDir = __dirname;
                while (true) {
                    const candidate = path.join(currentDir, 'pnpm-workspace.yaml');
                    try {
                        await fs.access(candidate);
                        return currentDir;
                    } catch {
                        const parent = path.dirname(currentDir);
                        if (parent === currentDir) {
                            throw new Error(
                                `Could not locate root (pnpm-workspace.yaml not found)--started from ${__dirname}, ended at ${currentDir}`,
                            );
                        }
                        currentDir = parent;
                    }
                }
            })();
        }
    }

    return _fullyQualifiedRepoRootPath;
};
