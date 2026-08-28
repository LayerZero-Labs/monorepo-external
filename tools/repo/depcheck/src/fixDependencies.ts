import fs from 'fs/promises';
import path from 'path';

import { runCatalogizeAll } from './catalog';
import {
    filterPackages,
    isLegacyPackage,
    MOVE_TO_DEV_DEFAULT_PATTERN,
    moveToDev,
    removeDuplicates,
    sortDependencies,
    SORTED_DEPENDENCY_SECTIONS,
    updateDeps,
    validateNoLegacyOrgDependencies,
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
    // Exclude legacy packages like `depcheck validate` does (validate.ts): depcheck
    // cannot accurately scan them (e.g. CLI-only deps like react-scripts), so fixdeps
    // rewriting them only dirtied the tree on every local `pnpm pr:check`.
    let packages: string[] = pnpmLs
        .map((p) => p.name)
        .filter((x) => x !== 'root' && !isLegacyPackage(x));

    // Filter packages using the unified filtering function
    packages = filterPackages({ packages, only, ignore, regex });

    console.log(`Matched ${packages.length} package(s)`);

    // Same legacy-org ban as `depcheck validate`. It is not autofixable (fixdeps cannot
    // know which dep to remove), so the fixer still reports it — fix what's fixable,
    // fail on the rest, same contract as `eslint --fix`.
    await validateNoLegacyOrgDependencies(packages, pnpmLsObject);

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

                for (const section of SORTED_DEPENDENCY_SECTIONS) {
                    const sortedSection = sortDependencies(
                        packageResult[packageJsonPath][section] || {},
                    );
                    packageResult[packageJsonPath][section] =
                        Object.keys(sortedSection).length > 0 ? sortedSection : undefined;
                }
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
