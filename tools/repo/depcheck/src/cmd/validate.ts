import { Command } from 'commander';

import {
    MOVE_TO_DEV_DEFAULT_PATTERN,
    moveToDev,
    removeDuplicates,
    updateDeps,
    validateCatalog,
} from '../deps';
import { safeRegexMatch } from '../safeRegex';
import type { ValidateDependenciesParams } from '../types';
import { getPnpmLs } from '../utils';

const validateMissingDependencies = async (options: {
    only?: string;
    ignorePatterns?: string[];
    dups?: boolean;
}) => {
    const { only, ignorePatterns, dups } = options;
    const shouldCheckDups = dups === false;
    const { pnpmLs, pnpmLsObject } = await getPnpmLs();
    const allPackages = pnpmLs.map((p) => p.name).filter((x) => x !== 'root');
    const targets = only
        ? allPackages.filter((n) => n === only || safeRegexMatch({ str: n, pattern: only }))
        : allPackages;

    console.log(`Matched ${targets.length} package(s)`);

    // Run the same logic as deps command but in read-only mode
    const packageResult = await updateDeps({
        packages: targets,
        pnpmLsObject,
        ignorePatterns,
    });

    // Check if moveToDev would make changes
    await moveToDev({
        packages: targets,
        packageResult,
        pattern: MOVE_TO_DEV_DEFAULT_PATTERN,
        pnpmLsObject,
    });

    // Check for duplicates if --no-dups flag is set
    if (shouldCheckDups) {
        await removeDuplicates({
            packages: targets,
            packageResult,
            pattern: MOVE_TO_DEV_DEFAULT_PATTERN,
            pnpmLsObject,
            write: false,
        });
    }

    // If packageResult has any entries, it means changes would be made
    if (Object.keys(packageResult).length > 0) {
        throw new Error('Dependency issues found: run `pnpm fixdeps` to fix');
    }
};

export const validateCmd = new Command('validate')
    .description('Validate dependencies and catalog for CI')
    .option('--missing-dependencies', 'Throw error if there are missing dependencies.')
    .option('--only <name>', 'Check only this workspace package (by exact name or regex pattern).')
    .option('--catalog', 'Throw error if the catalog is not up to date.')
    .option('--no-dups', 'check for duplicate packages in both dependencies and devDependencies')
    .option(
        '--ignore-patterns <patterns...>',
        'space-separated glob patterns to ignore in depcheck (e.g., docker/evm/script_that_runs_within_contrainer.ts)',
    )
    .action(async (options: ValidateDependenciesParams) => {
        const { missingDependencies, only, ignorePatterns, dups, catalog } = options;
        if (missingDependencies) {
            await validateMissingDependencies({ only, ignorePatterns, dups });
        }
        if (catalog) {
            await validateCatalog(only);
        }
    });
