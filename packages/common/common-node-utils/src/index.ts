import * as fs from 'fs/promises';
import path from 'path';

let _fullyQualifiedRepoRootPath: Promise<string> | undefined = undefined;
/**
 * Get the fully qualified path to the repository root by searching for pnpm-workspace.yaml
 * @returns The absolute path to the repository root
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

export * from './files';
