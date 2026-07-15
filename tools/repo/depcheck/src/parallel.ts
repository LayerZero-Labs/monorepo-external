import os from 'node:os';
import Tinypool from 'tinypool';

import type { Catalog, PackageJson, PnpmPackageObject } from './types';

/**
 * Below this package count we run in-process: the fixed cost of spawning worker
 * threads (each loads the depcheck/@babel toolchain) outweighs the gain, and
 * common local flows like `fixdeps --only <pkg>` stay on the simple path.
 */
const MIN_PACKAGES_FOR_WORKERS = 8;

/**
 * The heavy work in `updateDeps` is CPU-bound @babel parsing inside the
 * `depcheck` library, run once per workspace package. A single Node process
 * pins one core no matter how high the async concurrency limit is, so ~1400
 * packages parse serially on one core. This module shards that work across
 * worker threads (one per core) which is where the CI win comes from.
 */
export const getWorkerCount = (taskCount: number): number => {
    // Runtime perf toggle, not a turbo cache input.
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    const override = process.env.DEPCHECK_WORKERS;
    if (override) {
        const parsed = Number.parseInt(override, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return Math.min(parsed, taskCount);
        }
    }
    const cores =
        typeof os.availableParallelism === 'function'
            ? os.availableParallelism()
            : os.cpus().length;
    // The main thread only routes tasks while workers parse, so it stays
    // effectively idle — use all cores. This matters on small runners (e.g. the
    // 2-vCPU `ubuntu-latest` used by sanity_checks) where `cores - 1` would give
    // a single worker and defeat the point.
    return Math.max(1, Math.min(cores, taskCount));
};

export const shouldUseWorkers = (taskCount: number): boolean => {
    // eslint-disable-next-line turbo/no-undeclared-env-vars -- see getWorkerCount
    if (process.env.DEPCHECK_NO_WORKERS === '1') {
        return false;
    }
    return taskCount >= MIN_PACKAGES_FOR_WORKERS && getWorkerCount(taskCount) > 1;
};

// Resolve the sibling worker module for both runtime modes: `.ts` when running
// from source under tsx (CI's `checkdeps`), and `.js` when running the compiled
// dist bundle (the published bin). The worker activates the tsx loader itself
// (see depcheckWorker.ts), so no execArgv wiring is needed here.
const workerUrl = new URL(
    import.meta.url.endsWith('.ts') ? './depcheckWorker.ts' : './depcheckWorker.js',
    import.meta.url,
);

export type PackageResultEntry = [string, PackageJson] | null;

/**
 * Runs `processPackageDependencies` for every package across a pool of worker
 * threads. Results are returned in the same order as `params.packages` (index
 * aligned), matching the previous `Promise.all` behaviour.
 *
 * The full `allDeps` map and the resolved default `catalog` are sent to every
 * worker once (via workerData) so version resolution is independent of how
 * packages are sharded — the output is identical to the single-process path.
 */
export const runPackagesInWorkers = async (params: {
    packages: string[];
    allDeps: { [key: string]: Set<string> };
    pnpmLsObject: { [key: string]: PnpmPackageObject };
    workspacePackages: string[];
    ignorePatterns?: string[];
    catalog: Catalog;
}): Promise<PackageResultEntry[]> => {
    const { packages, allDeps, pnpmLsObject, workspacePackages, ignorePatterns, catalog } = params;

    // Slim the ls tree to just what the worker needs (name + path). Cloning the
    // full pnpm ls output into every worker would be needlessly expensive.
    const pnpmLsSlim: { [key: string]: { name: string; path: string } } = {};
    for (const name of packages) {
        const info = pnpmLsObject[name];
        if (!info) {
            throw new Error(`Package ${name} not found in pnpmLsObject`);
        }
        pnpmLsSlim[name] = { name: info.name, path: info.path };
    }

    // Sets survive structured clone, but arrays are cheaper and unambiguous.
    const allDepsSerializable: { [key: string]: string[] } = {};
    for (const dep of Object.keys(allDeps)) {
        allDepsSerializable[dep] = [...allDeps[dep]];
    }

    const workerCount = getWorkerCount(packages.length);
    console.log(
        `Running depcheck across ${workerCount} worker(s) for ${packages.length} package(s)...`,
    );

    const pool = new Tinypool({
        filename: workerUrl.href,
        minThreads: workerCount,
        maxThreads: workerCount,
        workerData: {
            pnpmLsSlim,
            allDeps: allDepsSerializable,
            workspacePackages,
            ignorePatterns,
            catalog,
        },
    });

    try {
        // Tinypool queues tasks and dispatches each to the next free worker, so
        // uneven package sizes stay balanced. A task that throws rejects its
        // promise, which surfaces here (matching the previous fail-fast behaviour).
        return await Promise.all(
            packages.map((packageName) => pool.run({ packageName }) as Promise<PackageResultEntry>),
        );
    } finally {
        await pool.destroy();
    }
};
