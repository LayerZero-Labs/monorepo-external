#!/usr/bin/env node
import { Command } from 'commander';

import { analyzeImportsCmd } from './cmd/analyzeImports';
import { catalogCmd } from './cmd/catalog';
import { depsCmd } from './cmd/deps';
import { exportCmd } from './cmd/export';
import { findCmd } from './cmd/find';
import { prioritizeWorkspaceDepsCmd } from './cmd/prioritizeWorkspaceDeps';
import { validateCmd } from './cmd/validate';
import { visualizeCmd } from './cmd/visualize';

const main = async () => {
    const program = new Command('depcheck').description(
        'Dependency management and analysis tools for pnpm monorepos',
    );

    program.addCommand(exportCmd);
    program.addCommand(findCmd);
    program.addCommand(depsCmd);
    program.addCommand(analyzeImportsCmd);
    program.addCommand(visualizeCmd);
    program.addCommand(validateCmd);
    program.addCommand(catalogCmd);
    program.addCommand(prioritizeWorkspaceDepsCmd);

    program.parse(process.argv);
};

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
