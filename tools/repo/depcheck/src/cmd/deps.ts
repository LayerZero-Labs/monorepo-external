import { Command } from 'commander';

import { MOVE_TO_DEV_DEFAULT_PATTERN } from '../deps';
import { fixDependencies } from '../fixDependencies';
import type { FixDependenciesParams } from '../types';

export const depsCmd = new Command('deps')
    .description('Check/Fix missing and unused package dependencies')
    .option('--no-sort', 'skip sorting dependencies')
    .option('-w, --write', 'write package.json files')
    .option('--catalogize', 'run catalogize after writing')
    .option('--to-dev <pattern>', 'move to dev', MOVE_TO_DEV_DEFAULT_PATTERN)
    .option('--only <name>', 'Check only this workspace package (by exact name or regex pattern).')
    .option('--ignore <ignore>', 'ignore packages')
    .option('--no-regex', 'Not use regex for pattern matching (applied on only, toDev, ignore).')
    .option(
        '--no-dups',
        'check and fix duplicate packages in both dependencies and devDependencies',
    )
    .option(
        '--ignore-patterns <patterns...>',
        'space-separated glob patterns to ignore in depcheck (e.g., docker/evm/script_that_runs_within_contrainer.ts)',
    )
    .action(async (options: FixDependenciesParams) => {
        await fixDependencies(options);
    });
