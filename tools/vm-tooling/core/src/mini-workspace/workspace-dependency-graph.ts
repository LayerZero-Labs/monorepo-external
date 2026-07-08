import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';

import { findFileInParentDirectory } from '../utils';
import { isInside } from '../utils/fs';
import type {
    WorkspaceDependencyEdge,
    WorkspaceDependencyGraph,
    WorkspaceDependencyGraphOptions,
} from './types';

const LOCKFILE_DEPENDENCY_GROUPS = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
] as const;

interface LockfileDependency {
    name: string;
    version: string;
}

interface LockfileImporter {
    dependencies?: Record<string, { version?: string } | string>;
    devDependencies?: Record<string, { version?: string } | string>;
    optionalDependencies?: Record<string, { version?: string } | string>;
}

type LockfileImporters = Record<string, LockfileImporter>;

interface PnpmLockfile {
    importers?: LockfileImporters;
}

interface LockfileImportersCacheEntry {
    repoRoot: string;
    mtimeMs: number;
    size: number;
    importers: LockfileImporters;
}

let lockfileImportersCache: LockfileImportersCacheEntry | undefined;

const normalizeRelativePath = (path: string): string => path.split(sep).join('/');

const isLinkVersion = (dependency: LockfileDependency): boolean =>
    dependency.version.startsWith('link:');

const findPnpmWorkspaceRoot = async (startDir: string): Promise<string> => {
    const workspaceFile = await findFileInParentDirectory(startDir, 'pnpm-workspace.yaml');

    if (!workspaceFile) {
        throw new Error(`Could not find pnpm-workspace.yaml above ${startDir}`);
    }

    return dirname(workspaceFile);
};

const isFileNotFoundError = (error: unknown): boolean => {
    const code =
        typeof error === 'object' && error !== null ? (error as { code?: string }).code : undefined;

    return code === 'ENOENT';
};

const isFile = async (path: string): Promise<boolean> => {
    try {
        const stats = await lstat(path);
        return stats.isFile();
    } catch (error) {
        if (!isFileNotFoundError(error)) {
            throw error;
        }

        return false;
    }
};

/**
 * Find the workspace package that owns the command cwd.
 *
 * Tool commands are often run from nested directories such as `contracts/solana`, while
 * pnpm-lock.yaml only indexes package roots. Walking upward lets the mini workspace bind-mount the
 * owning package instead of treating the nested cwd as its own package. The package.json check keeps
 * the search anchored to real package boundaries; the importer check makes sure that package is
 * actually represented in the lockfile graph we use for dependency discovery.
 */
const findPackageRoot = async (
    startDir: string,
    repoRoot: string,
    importers: LockfileImporters,
): Promise<string> => {
    let current = startDir;

    for (;;) {
        const relativePath = normalizeRelativePath(relative(repoRoot, current)) || '.';

        if (await isFile(join(current, 'package.json'))) {
            if (importers[relativePath]) return current;
        }

        if (current === repoRoot) break;

        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }

    const startRelativePath = normalizeRelativePath(relative(repoRoot, startDir)) || '.';
    throw new Error(
        `No pnpm-lock.yaml importer found for ${startRelativePath} or any ancestor package.json`,
    );
};

/**
 * Read pnpm-lock.yaml as structured YAML instead of depending on indentation.
 *
 * pnpm also exposes `@pnpm/lockfile.fs` for this, but adding that internal package pulls a sizeable
 * pnpm dependency tree into this repo. For this graph we only need the stable `importers`
 * object, so a normal YAML parser keeps the implementation robust without lockfile churn.
 */
const readLockfileImporters = async (repoRoot: string): Promise<LockfileImporters> => {
    const lockfilePath = join(repoRoot, 'pnpm-lock.yaml');
    const handle = await open(lockfilePath, 'r');
    const cached = lockfileImportersCache;

    try {
        const stats = await handle.stat();

        if (
            cached &&
            cached.repoRoot === repoRoot &&
            cached.mtimeMs === stats.mtimeMs &&
            cached.size === stats.size
        ) {
            return cached.importers;
        }

        const lockfile = parse(await handle.readFile('utf-8')) as PnpmLockfile | null;

        if (!lockfile?.importers) {
            throw new Error(`Could not read pnpm-lock.yaml from ${repoRoot}`);
        }

        lockfileImportersCache = {
            repoRoot,
            mtimeMs: stats.mtimeMs,
            size: stats.size,
            importers: lockfile.importers,
        };

        return lockfile.importers;
    } finally {
        await handle.close();
    }
};

const getDependencyVersion = (dependency: { version?: string } | string): string | undefined =>
    typeof dependency === 'string' ? dependency : dependency.version;

const getImporterDependencies = (importer: LockfileImporter): LockfileDependency[] =>
    LOCKFILE_DEPENDENCY_GROUPS.flatMap((group) =>
        Object.entries(importer[group] ?? {}).flatMap(([name, dependency]) => {
            const version = getDependencyVersion(dependency);
            return version ? [{ name, version }] : [];
        }),
    );

const resolveLockfileLinkTarget = (
    repoRoot: string,
    importerRelativePath: string,
    version: string,
): string => {
    const linkTarget = version.slice('link:'.length);
    const importerDir =
        importerRelativePath === '.' ? repoRoot : join(repoRoot, importerRelativePath);

    return resolve(importerDir, linkTarget);
};

/**
 * Resolve the repo-local workspace dependency graph for package-root container builds.
 *
 * The traversal is recursive in graph terms, but not expensive in filesystem terms: it follows
 * lockfile `link:` edges between importers instead of scanning packages or tool manifests. That means
 * transitive source packages such as `anchor-trait` are included when reached through `oapp`/`oft`.
 */
export const resolveWorkspaceDependencyGraph = async (
    options: WorkspaceDependencyGraphOptions = {},
): Promise<WorkspaceDependencyGraph> => {
    const cwd = resolve(options.cwd ?? process.cwd());
    const cwdReal = await realpath(cwd);
    const repoRoot = options.repoRoot
        ? await realpath(options.repoRoot)
        : await findPnpmWorkspaceRoot(cwdReal);
    const importers = await readLockfileImporters(repoRoot);
    const packageRootReal = await findPackageRoot(cwdReal, repoRoot, importers);
    const packageRelativePath = normalizeRelativePath(relative(repoRoot, packageRootReal)) || '.';

    if (!importers[packageRelativePath]) {
        throw new Error(`No pnpm-lock.yaml importer found for ${packageRelativePath}`);
    }

    const rootImporterDependencyNames = new Set(
        getImporterDependencies(importers['.'] ?? {}).map((dependency) => dependency.name),
    );

    const queue = [packageRelativePath];
    const visitedImporters = new Set<string>();
    const includedByPath = new Map<string, WorkspaceDependencyEdge>();
    const rootNodeModulesDependencyNames = new Set<string>();

    while (queue.length > 0) {
        const importerRelativePath = queue.shift()!;
        if (visitedImporters.has(importerRelativePath)) continue;
        visitedImporters.add(importerRelativePath);

        const importer = importers[importerRelativePath];
        if (!importer) {
            throw new Error(
                `No pnpm-lock.yaml importer found for transitive workspace package ${importerRelativePath}`,
            );
        }

        const dependencies = getImporterDependencies(importer);

        for (const dependency of dependencies) {
            if (rootImporterDependencyNames.has(dependency.name)) {
                rootNodeModulesDependencyNames.add(dependency.name);
            }

            if (!isLinkVersion(dependency)) continue;

            const absolutePath = await realpath(
                resolveLockfileLinkTarget(repoRoot, importerRelativePath, dependency.version),
            );
            const dependencyRelativePath = normalizeRelativePath(relative(repoRoot, absolutePath));

            if (!isInside(repoRoot, absolutePath)) {
                throw new Error(
                    `Workspace dependency ${dependency.name} resolves outside the repository: ${absolutePath}`,
                );
            }

            if (dependencyRelativePath === packageRelativePath) continue;

            if (!includedByPath.has(dependencyRelativePath)) {
                includedByPath.set(dependencyRelativePath, {
                    name: dependency.name,
                    importerRelativePath,
                    relativePath: dependencyRelativePath,
                    absolutePath,
                    version: dependency.version,
                });
                queue.push(dependencyRelativePath);
            }
        }
    }

    return {
        repoRoot,
        packageRoot: packageRootReal,
        packageRelativePath,
        rootNodeModulesDependencyNames: [...rootNodeModulesDependencyNames],
        includedWorkspaceDependencies: [...includedByPath.values()],
    };
};
