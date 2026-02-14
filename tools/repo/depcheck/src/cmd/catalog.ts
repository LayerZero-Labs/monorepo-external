import { Command } from 'commander';

import { runCatalogizeAll } from '../catalog';
import { safeRegexMatch } from '../safeRegex';
import { getPnpmLs } from '../utils';

export const catalogCmd = new Command('catalogize')
    .description('Move dependency versions to pnpm workspace catalog')
    .option('--only <name>', 'Check only this workspace package (by exact name or regex pattern).')
    .option('--dependencies <dependencies>', 'only run the catalogize on the given dependencies')
    .action(async (option: { only: string; dependencies: string }) => {
        const { pnpmLs, pnpmLsObject } = await getPnpmLs();
        const dependenciesFilter: string[] = option.dependencies
            ? option.dependencies.split(',')
            : [];

        const packages = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');
        const filteredPackages = option.only
            ? packages.filter(
                  (n) => n === option.only || safeRegexMatch({ str: n, pattern: option.only }),
              )
            : packages;

        console.log(`Matched ${filteredPackages.length} package(s)`);
        await runCatalogizeAll({
            packages: filteredPackages,
            pnpmLsObject,
            dependenciesFilter,
        });
    });
