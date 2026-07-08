import { lstat, mkdir, readlink, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pLimit from 'p-limit';

import type {
    PnpmVirtualStoreMount,
    RootNodeModulesSymlinkCopyOptions,
    RootNodeModulesSymlinkCopyResult,
} from './types';

export const COPY_CONCURRENCY = 10;

const copyNodeModulesSymlinks = async (
    sourceDir: string,
    targetDir: string,
    dependencyNames: readonly string[],
): Promise<string[]> => {
    const limit = pLimit(COPY_CONCURRENCY);

    const symlinks = await Promise.all(
        dependencyNames.map((packageName) =>
            limit(async (): Promise<string | undefined> => {
                const sourcePath = join(sourceDir, packageName);
                const targetPath = join(targetDir, packageName);
                const stats = await lstat(sourcePath);

                if (!stats.isSymbolicLink()) return undefined;

                await mkdir(dirname(targetPath), { recursive: true });
                await symlink(await readlink(sourcePath), targetPath);

                return packageName;
            }),
        ),
    );

    return symlinks.flatMap((symlink) => (symlink ? [symlink] : []));
};

/**
 * Copy selected root node_modules dependency symlinks into a mini workspace.
 *
 * pnpm's node_modules is primarily symlinks over node_modules/.pnpm and workspace packages.
 * Copying those symlinks does not copy their targets. The `.pnpm` virtual store is provided by a
 * read-only Docker mount. Package dependency resolution stays package-local; the graph decides
 * which root node_modules entries are needed by the workspace package closure.
 */
export const copyRootNodeModulesSymlinks = async ({
    repoRoot,
    miniRoot,
    dependencyNames,
}: RootNodeModulesSymlinkCopyOptions): Promise<RootNodeModulesSymlinkCopyResult> => {
    const sourceNodeModules = join(repoRoot, 'node_modules');
    const targetNodeModules = join(miniRoot, 'node_modules');

    // Pre-create the .pnpm mountpoint (recursive mkdir also creates node_modules)
    // so Docker can bind-mount the virtual store over it.
    await mkdir(join(targetNodeModules, '.pnpm'), { recursive: true });
    const symlinks = await copyNodeModulesSymlinks(
        sourceNodeModules,
        targetNodeModules,
        dependencyNames,
    );

    return {
        nodeModulesPath: targetNodeModules,
        symlinks: symlinks.sort(),
    };
};

/**
 * Describe the pnpm virtual store mount used by package-root container builds.
 *
 * The implementation should mount `.pnpm` instead of copying it. This preserves pnpm's dependency
 * topology without copying the virtual store into every mini workspace.
 */
export const getPnpmVirtualStoreMount = (
    repoRoot: string,
    containerWorkspaceRoot = '/workspace',
): PnpmVirtualStoreMount => ({
    hostPath: join(repoRoot, 'node_modules', '.pnpm'),
    containerPath: `${containerWorkspaceRoot}/node_modules/.pnpm`,
    readOnly: true,
});
