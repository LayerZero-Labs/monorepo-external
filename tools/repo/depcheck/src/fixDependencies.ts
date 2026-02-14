import fs from 'fs/promises';
import path from 'path';

import { runCatalogizeAll } from './catalog';
import {
    filterPackages,
    MOVE_TO_DEV_DEFAULT_PATTERN,
    moveToDev,
    removeDuplicates,
    sortDependencies,
    updateDeps,
} from './deps';
import type { FixDependenciesParams, PackageJson } from './types';
import { getPnpmLs } from './utils';

export const fixDependencies = async (options: FixDependenciesParams) => {
    const originalCwd = process.cwd();
    try {
        if (options.cwd) {
            process.chdir(options.cwd);
        }
        return await _fixDeps(options);
    } finally {
        process.chdir(originalCwd);
    }
};

async function _fixDeps(options: FixDependenciesParams) {
    const {
        only,
        ignore,
        ignorePatterns,
        toDev,
        regex,
        sort,
        write,
        catalogize,
        customCatalog,
        preventCatalogsCleanup = false,
        dups,
    } = options;
    // Commander.js maps --no-dups to 'dups' property
    // When --no-dups is passed, dups is false. When omitted, dups is undefined.
    // We want to check duplicates when the flag is explicitly passed (dups === false)
    const shouldCheckDups = dups === false;
    const { pnpmLs, pnpmLsObject } = await getPnpmLs({ workspacePackagesOnly: true });
    let packages: string[] = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');

    // Filter packages using the unified filtering function
    packages = filterPackages({ packages, only, ignore, regex });

    console.log(`Matched ${packages.length} package(s)`);

    // Update dependencies for the filtered packages
    const packageResult = await updateDeps({
        packages,
        pnpmLsObject,
        ignorePatterns,
        customCatalog,
    });

    if (toDev) {
        // Move packages matching the pattern to devDependencies for the filtered packages
        await moveToDev({ packages, packageResult, pattern: toDev, pnpmLsObject });
    }

    if (shouldCheckDups) {
        // Check and fix duplicate packages in both dependencies and devDependencies
        await removeDuplicates({
            packages,
            packageResult,
            pattern: toDev || MOVE_TO_DEV_DEFAULT_PATTERN,
            pnpmLsObject,
            regex,
            write,
        });
    }

    if (sort) {
        await Promise.all(
            packages.map(async (packageName) => {
                const packageJsonPath = path.join(pnpmLsObject[packageName].path, 'package.json');

                if (!packageResult[packageJsonPath]) {
                    packageResult[packageJsonPath] = JSON.parse(
                        await fs.readFile(packageJsonPath, 'utf-8'),
                    ) as PackageJson;
                }

                const sortedDependencies = sortDependencies(
                    packageResult[packageJsonPath].dependencies || {},
                );
                packageResult[packageJsonPath].dependencies =
                    Object.keys(sortedDependencies).length > 0 ? sortedDependencies : undefined;

                const sortedDevDependencies = sortDependencies(
                    packageResult[packageJsonPath].devDependencies || {},
                );
                packageResult[packageJsonPath].devDependencies =
                    Object.keys(sortedDevDependencies).length > 0
                        ? sortedDevDependencies
                        : undefined;

                const sortedImplicitDependencies = sortDependencies(
                    packageResult[packageJsonPath].implicitDependencies || {},
                );
                packageResult[packageJsonPath].implicitDependencies =
                    Object.keys(sortedImplicitDependencies).length > 0
                        ? sortedImplicitDependencies
                        : undefined;
            }),
        );
    }

    if (write) {
        for (const p in packageResult) {
            await fs.writeFile(p, JSON.stringify(packageResult[p], null, 4) + '\n');
        }
    }

    if (catalogize && write) {
        await runCatalogizeAll({
            packages,
            pnpmLsObject,
            dependenciesFilter: [],
            customCatalog,
            preventCatalogsCleanup,
        });
    }
}
