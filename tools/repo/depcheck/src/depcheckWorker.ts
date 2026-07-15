import Tinypool from 'tinypool';

import type { Catalog, PackageJson, PnpmPackageObject } from './types';

interface WorkerData {
    pnpmLsSlim: { [key: string]: { name: string; path: string } };
    allDeps: { [key: string]: string[] };
    workspacePackages: string[];
    ignorePatterns?: string[];
    catalog: Catalog;
}

type ProcessPackageDependencies = (params: {
    packageName: string;
    allDeps: { [key: string]: Set<string> };
    packageInfo?: PnpmPackageObject;
    workspacePackages: Set<string>;
    ignorePatterns?: string[];
    customCatalog?: Catalog;
}) => Promise<[string, PackageJson] | null>;

// A worker thread does not inherit the parent's tsx loader, so nested imports in
// `./deps` (extensionless, TS) won't resolve under Node's default ESM resolver.
// When running from source, activate tsx's loader in this thread via its
// programmatic API before importing. The `./deps.js` specifier resolves to
// `deps.ts` via tsx in source and to the real `deps.js` in the dist bundle.
if (import.meta.url.endsWith('.ts')) {
    const { register } = await import('tsx/esm/api');
    register();
}
const { processPackageDependencies } = (await import('./deps.js')) as {
    processPackageDependencies: ProcessPackageDependencies;
};

// Shared, read-mostly state sent once per worker. Rebuild the shapes flattened
// for structured clone. Each worker owns its own copy of allDeps;
// `processPackageDependencies` may extend it via addMissingDependencies, but
// because the full allDeps (built from every package) is seeded here, version
// resolution is identical to the single-process path regardless of sharding.
const data = Tinypool.workerData as WorkerData;
const allDeps: { [key: string]: Set<string> } = {};
for (const dep of Object.keys(data.allDeps)) {
    allDeps[dep] = new Set(data.allDeps[dep]);
}
const workspacePackages = new Set(data.workspacePackages);

export default ({ packageName }: { packageName: string }) =>
    processPackageDependencies({
        packageName,
        allDeps,
        packageInfo: data.pnpmLsSlim[packageName],
        workspacePackages,
        ignorePatterns: data.ignorePatterns,
        // Pass the pre-resolved default catalog so each worker doesn't re-run
        // `pnpm m ls` via getCachedCatalog(). Same catalog the single-process
        // path would have used.
        customCatalog: data.catalog,
    });
