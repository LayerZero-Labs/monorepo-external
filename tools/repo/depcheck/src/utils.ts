import { exec } from 'child_process';
import fs from 'fs';
import yaml from 'js-yaml';
import path from 'path';
import util from 'util';

import type { Graph } from './graph';
import type { Catalog, PackageJson, PnpmPackageObject, PnpmWorkspace } from './types';

let cachedPnpmLs: {
    pnpmLs: PnpmPackageObject[];
    pnpmLsObject: { [key: string]: PnpmPackageObject };
} | null = null;

export const execPromise = util.promisify(exec);

export const checkAccess = async (
    graph: Graph,
    pnpmLsObjects: { [key: string]: PnpmPackageObject },
    accessFunction: (
        packageName: string,
        pnpmLsObjects: { [key: string]: PnpmPackageObject },
    ) => Promise<boolean>,
) => {
    const nodes = graph.getNodes();
    const catalog = await getCachedCatalog();

    let failedFlag = false;
    for (const node of nodes) {
        const packageName = node.getId();

        // Skip catalog packages (external dependencies)
        if (catalog && catalog[packageName]) {
            continue;
        }

        const isPublic = await accessFunction(packageName, pnpmLsObjects);
        if (!isPublic) {
            console.error(`${packageName} is not public`);
            failedFlag = true;
        }
    }

    return failedFlag;
};

/**
 * Check access for only the reachable nodes from a specific package.
 * This is more efficient than checking the entire graph when you only care about
 * dependencies of a specific package.
 */
export const checkReachableNodesAccess = async (
    graph: Graph,
    packageName: string,
    pnpmLsObjects: { [key: string]: PnpmPackageObject },
    accessFunction: (
        packageName: string,
        pnpmLsObjects: { [key: string]: PnpmPackageObject },
    ) => Promise<boolean>,
) => {
    const node = graph.getNode(packageName);
    if (!node) {
        throw new Error(`Package ${packageName} not found in graph`);
    }

    const reachableNodeIds = graph.getReachableNodes(node);
    const catalog = await getCachedCatalog();

    let failedFlag = false;
    for (const pkgName of reachableNodeIds) {
        // Skip catalog packages (external dependencies)
        if (catalog && catalog[pkgName]) {
            continue;
        }

        const hasAccess = await accessFunction(pkgName, pnpmLsObjects);
        if (!hasAccess) {
            console.error(`${pkgName} does not have access`);
            failedFlag = true;
        }
    }

    return failedFlag;
};

export const isPackagePublic = async (
    packageName: string,
    pnpmLsObjects: { [key: string]: PnpmPackageObject },
) => {
    const pnpmLsObject = pnpmLsObjects[packageName];
    const packageJsonPath = path.join(pnpmLsObject.path, 'package.json');
    const packageJson: PackageJson = JSON.parse(
        await fs.promises.readFile(packageJsonPath, 'utf-8'),
    );
    if (packageJson.private == null) {
        throw new Error(`${packageJson.name} has no 'private' field set in package.json`);
    }
    return packageJson.publishConfig?.access === 'public' && !packageJson.private;
};

export const getPnpmLs = async (
    params: { workspacePackagesOnly: boolean } = { workspacePackagesOnly: false },
) => {
    const { workspacePackagesOnly } = params;
    // In-memory cache for the lifetime of the process
    if (cachedPnpmLs) {
        return cachedPnpmLs;
    }

    // Buffer size is picked experimentally
    let command = ['pnpm', 'm', 'ls', '--json'];
    if (workspacePackagesOnly) {
        command.push('--depth', '-1');
    }
    const { stdout } = await execPromise(command.join(' '), { maxBuffer: 10000000 });
    const pnpmLs: PnpmPackageObject[] = JSON.parse(stdout);
    const pnpmLsObject = Object.fromEntries(pnpmLs.map((x) => [x.name, x]));
    cachedPnpmLs = { pnpmLs, pnpmLsObject };
    return cachedPnpmLs;
};

export const getPnpmWorkspace = async () => {
    const { pnpmLsObject } = await getPnpmLs();
    let rootPackage: PnpmPackageObject = pnpmLsObject['root'];
    let pnpmWorkspace: PnpmWorkspace = yaml.load(
        await fs.promises.readFile(path.join(rootPackage.path, 'pnpm-workspace.yaml'), 'utf-8'),
    ) as PnpmWorkspace;
    return pnpmWorkspace;
};

/**
 * Returns the catalog values from pnpm-workspace.yaml.
 * It reads the file everytime, so ensure it's used accordingly.
 * If you need to read the catalog multiple times, use getCachedCatalog.
 */
export const getCatalog = async (): Promise<Catalog> => {
    const pnpmWorkspace = await getPnpmWorkspace();
    return pnpmWorkspace.catalog || {};
};

/**
 * Returns a function that returns a promise,
 * resolved is the cached catalog values from pnpm-workspace.yaml.
 */
let cachedCatalog: Catalog | null = null;

export const getCachedCatalog = async (): Promise<Catalog> => {
    if (!cachedCatalog) {
        cachedCatalog = await getCatalog();
    }
    return cachedCatalog;
};

export const invalidateCachedCatalog = (): void => {
    cachedCatalog = null;
};

/**
 * Reads the project's pnpm-workspace.yaml file and writes the catalog to it.
 *
 * @param catalog - The catalog to write.
 * @param options - The options for writing the catalog.
 * @param options.preventCatalogsCleanup - If true, the `cleanupUnusedCatalogs` flag is set to false, so unused catalogs will not be cleaned up.
 */
export const writeCatalog = async (
    catalog: Catalog,
    options: { preventCatalogsCleanup?: boolean },
) => {
    const { pnpmLsObject } = await getPnpmLs();
    let rootPackage: PnpmPackageObject = pnpmLsObject['root'];
    const pnpmWorkspace = await getPnpmWorkspace();
    pnpmWorkspace.catalog = catalog;
    if (options.preventCatalogsCleanup) {
        pnpmWorkspace.cleanupUnusedCatalogs = false;
    }

    await fs.promises.writeFile(
        path.join(rootPackage.path, 'pnpm-workspace.yaml'),
        yaml.dump(pnpmWorkspace),
    );
    invalidateCachedCatalog();
};

export const getPrivateDepsFixSuggestion = (errorMessage: string, packageName: string) => {
    const fixSuggestion = `▶ pnpm publicize-package ${packageName} --apply`;

    return (
        errorMessage +
        '\n\n💡 You can run the following command to fix this:' +
        '\n────────────────────────────────────────────────────────────────\n' +
        `\x1b[92m${fixSuggestion}\x1b[0m` +
        '\n────────────────────────────────────────────────────────────────\n'
    );
};
