import fs from 'fs/promises';
import path from 'path';

import type { Catalog, PackageJson, PnpmPackageObject } from './types';
import { getCatalog, writeCatalog } from './utils';

export const catalogize = async (
    packageObject: PnpmPackageObject,
    catalog: Catalog,
    dependenciesFilter: string[],
): Promise<{ throwError: boolean; changed: boolean; resultPackageJson: PackageJson }> => {
    const packageJson = JSON.parse(
        await fs.readFile(path.join(packageObject.path, 'package.json'), 'utf-8'),
    ) as PackageJson;
    const deps = packageJson.dependencies || {};
    const devDeps = packageJson.devDependencies || {};
    const implicitDeps = packageJson.implicitDependencies || {};

    let throwError: boolean;
    let resultThrowError = false;
    let changed: boolean;
    let resultChanged = false;

    ({ throwError, changed } = inplaceCatalog(
        packageObject.name,
        deps,
        catalog,
        dependenciesFilter,
    ));
    resultThrowError = throwError || resultThrowError;
    resultChanged = changed || resultChanged;

    ({ throwError, changed } = inplaceCatalog(
        packageObject.name,
        devDeps,
        catalog,
        dependenciesFilter,
    ));
    resultThrowError = throwError || resultThrowError;
    resultChanged = changed || resultChanged;

    ({ throwError, changed } = inplaceCatalog(
        packageObject.name,
        implicitDeps,
        catalog,
        dependenciesFilter,
    ));
    resultThrowError = throwError || resultThrowError;
    resultChanged = changed || resultChanged;

    return { throwError: resultThrowError, changed: resultChanged, resultPackageJson: packageJson };
};

const inplaceCatalog = (
    packageName: string,
    deps: Record<string, string>,
    catalog: Catalog,
    dependenciesFilter: string[],
): { throwError: boolean; changed: boolean } => {
    let throwError = false;
    let changed = false;
    for (const dependency of Object.keys(deps)) {
        if (dependenciesFilter.length > 0 && !dependenciesFilter.includes(dependency)) {
            continue;
        }
        if (deps[dependency].startsWith('workspace:')) {
            continue;
        }
        if (deps[dependency].startsWith('catalog:')) {
            continue;
        }
        if (!catalog[dependency]) {
            catalog[dependency] = deps[dependency];
            deps[dependency] = 'catalog:';
            changed = true;
            continue;
        }
        if (catalog[dependency] !== deps[dependency]) {
            console.error(
                `[${packageName}] ${dependency} has different version in catalog and package.json, catalog: ${catalog[dependency]}, package.json: ${deps[dependency]}`,
            );
            throwError = true;
        }

        deps[dependency] = 'catalog:';
        changed = true;
    }

    return { throwError, changed };
};

export const runCatalogizeAll = async (params: {
    packages: string[];
    pnpmLsObject: { [key: string]: PnpmPackageObject };
    dependenciesFilter: string[];
    customCatalog?: Catalog;
    preventCatalogsCleanup?: boolean;
}): Promise<void> => {
    const {
        packages,
        pnpmLsObject,
        dependenciesFilter,
        customCatalog,
        preventCatalogsCleanup = false,
    } = params;
    const catalog = customCatalog || (await getCatalog());
    let throwError = false;
    let changed = false;
    const resultPackageJsons: Record<string, PackageJson> = {};

    for (const packageName of packages) {
        const {
            throwError: tmpThrowError,
            changed: tmpChanged,
            resultPackageJson,
        } = await catalogize(pnpmLsObject[packageName], catalog, dependenciesFilter);
        throwError = tmpThrowError || throwError;
        changed = tmpChanged || changed;
        if (tmpChanged) {
            resultPackageJsons[packageName] = resultPackageJson;
        }
    }

    if (throwError) {
        throw new Error('catalogize failed');
    }

    if (changed) {
        for (const packageName in resultPackageJsons) {
            await fs.writeFile(
                path.join(pnpmLsObject[packageName].path, 'package.json'),
                JSON.stringify(resultPackageJsons[packageName], null, 4) + '\n',
            );
        }
        const sortedCatalog = Object.fromEntries(
            Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)),
        );
        await writeCatalog(sortedCatalog, { preventCatalogsCleanup });
    }
};
