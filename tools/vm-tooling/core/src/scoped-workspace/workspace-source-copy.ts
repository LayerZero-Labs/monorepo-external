import { glob } from 'glob';
import { copyFile, lstat, mkdir, mkdtemp, readlink, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pLimit from 'p-limit';

import { isInside, safeRemove } from '../utils/fs';
import { COPY_CONCURRENCY } from './node-modules';
import type { WorkspaceSourceCopyOptions, WorkspaceSourceCopyResult } from './types';

export const DEFAULT_SOURCE_COPY_PATTERNS = ['**/*'] as const;

// TODO(#5328): This allowlist is temporary. VM-specific pruners should own build-output
// selection, and #5328 will remove this fallback once those pruners are in place.
const DEFAULT_SOURCE_COPY_ALLOWLIST_PATTERNS = [
    'target/wasm32v1-none/release/*.d',
    'target/wasm32v1-none/release/*.wasm',
];

export const DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS = [
    '!**/.git/**',
    '!**/.next/**',
    '!**/.pnpm/**',
    '!**/.turbo/**',
    '!**/artifacts*/**',
    '!**/build/**',
    '!**/cache/**',
    '!**/debug_info/**',
    '!**/hh-cache/**',
    '!**/out/**',
    '!**/target/**',
    '!**/typechain-types/**',
] as const;

const getPathSegments = (relativePath: string): string[] =>
    relativePath ? relativePath.split('/') : [];

const isInsideNodeModules = (relativePath: string): boolean =>
    getPathSegments(relativePath).includes('node_modules');

const partitionGlobPatterns = (
    patterns: readonly string[],
): { include: string[]; ignore: string[] } => {
    const include: string[] = [];
    const ignore: string[] = [];

    for (const pattern of patterns) {
        if (pattern.startsWith('!')) {
            ignore.push(pattern.slice(1));
        } else {
            include.push(pattern);
        }
    }

    return { include, ignore };
};

const copySourceDirectory = async (
    sourceDir: string,
    destDir: string,
    copyPatterns: readonly string[],
): Promise<void> => {
    await mkdir(destDir, { recursive: true });

    const { include, ignore } = partitionGlobPatterns(copyPatterns);
    const globOptions = {
        cwd: sourceDir,
        dot: true,
        follow: false,
        nodir: false,
        posix: true,
    };
    const defaultEntries = await glob(include, { ...globOptions, ignore });
    const allowlistedEntries = await glob([...DEFAULT_SOURCE_COPY_ALLOWLIST_PATTERNS], globOptions);
    const entries = [...new Set([...defaultEntries, ...allowlistedEntries])];
    const limit = pLimit(COPY_CONCURRENCY);

    await Promise.all(
        entries.sort().map((relativePath) =>
            limit(async () => {
                const sourcePath = join(sourceDir, relativePath);
                const destPath = join(destDir, relativePath);
                const stats = await lstat(sourcePath);

                if (stats.isDirectory()) return;

                if (stats.isSymbolicLink()) {
                    await mkdir(dirname(destPath), { recursive: true });
                    try {
                        await symlink(await readlink(sourcePath), destPath);
                    } catch (error) {
                        // A workspace package nested under another package root can be copied
                        // twice (once via the parent tree, once as its own importer). Treat an
                        // identical existing symlink as success.
                        const code =
                            typeof error === 'object' && error !== null
                                ? (error as { code?: string }).code
                                : undefined;
                        if (code !== 'EEXIST') throw error;
                        const existing = await readlink(destPath).catch(() => undefined);
                        const intended = await readlink(sourcePath);
                        if (existing !== intended) throw error;
                    }
                    return;
                }

                if (isInsideNodeModules(relativePath)) return;

                if (!stats.isFile()) return;

                await mkdir(dirname(destPath), { recursive: true });
                await copyFile(sourcePath, destPath);
            }),
        ),
    );
};

const getPackageSourceCopyPatterns = ({
    relativePath,
    prunePatterns,
    packagePrunePatterns,
}: {
    relativePath: string;
    prunePatterns?: readonly string[];
    packagePrunePatterns?: Readonly<Record<string, readonly string[]>>;
}): readonly string[] => {
    const packagePatterns = packagePrunePatterns?.[relativePath];

    if (packagePatterns) {
        return packagePatterns.length ? packagePatterns : DEFAULT_SOURCE_COPY_PATTERNS;
    }
    if (prunePatterns?.length) return prunePatterns;

    return DEFAULT_SOURCE_COPY_PATTERNS;
};

/**
 * Copy only dependency source-like files for the resolved workspace dependency graph into a
 * repo-shaped scoped workspace.
 *
 * The current package itself is not copied. It is mounted from the host at the same repo-relative
 * path by the Docker executor so package-local build outputs such as `target`, `build`, and
 * `src/generated` land in the real package. Generated artifacts and caches are deliberately
 * excluded from dependency copies. Package-local node_modules directories are copied as symlinks
 * only, relying on the root `.pnpm` virtual store mount for external package contents.
 */
export const copyWorkspaceSources = async (
    options: WorkspaceSourceCopyOptions,
): Promise<WorkspaceSourceCopyResult> => {
    const scopedRoot = await mkdtemp(join(tmpdir(), 'lz-scoped-workspace-'));
    const { prunePatterns, packagePrunePatterns } = options;

    const copyPackageSource = async ({
        absolutePath,
        relativePath,
    }: {
        absolutePath: string;
        relativePath: string;
    }): Promise<void> => {
        if (!isInside(options.dependencyGraph.repoRoot, absolutePath)) {
            throw new Error(
                `Refusing to copy workspace package outside repository root: ${absolutePath}`,
            );
        }

        await copySourceDirectory(absolutePath, join(scopedRoot, relativePath), [
            ...getPackageSourceCopyPatterns({
                relativePath,
                prunePatterns,
                packagePrunePatterns,
            }),
            ...DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS,
        ]);
    };

    try {
        await mkdir(dirname(join(scopedRoot, options.dependencyGraph.packageRelativePath)), {
            recursive: true,
        });

        const limit = pLimit(COPY_CONCURRENCY);
        await Promise.all(
            options.dependencyGraph.includedWorkspaceDependencies.map((dependency) =>
                limit(async () => {
                    await copyPackageSource({
                        absolutePath: dependency.absolutePath,
                        relativePath: dependency.relativePath,
                    });
                }),
            ),
        );
    } catch (error) {
        await safeRemove(scopedRoot);
        throw error;
    }

    return {
        repoRoot: options.dependencyGraph.repoRoot,
        packageRoot: options.dependencyGraph.packageRoot,
        scopedRoot,
        packageRelativePath: options.dependencyGraph.packageRelativePath,
        copiedWorkspaceDependencies: options.dependencyGraph.includedWorkspaceDependencies,
    };
};
