#!/usr/bin/env tsx
import { Command } from 'commander';

import { logger, parseLogLevel, setLogLevel } from './logger';
import { resolveDependencies } from './resolve';

const main = async (): Promise<void> => {
    const program = new Command();
    program
        .name('build-utils-rust')
        .description('Build utilities for Rust/Cargo packages in LayerZero.');

    program
        .command('resolve')
        .description(
            'Resolve @layerzerolabs Cargo dependencies from node_modules into a flat ' +
                'dependencies/ directory with rewritten path deps.',
        )
        .option('--cwd <path>', 'pnpm package root (where node_modules/ lives). Default: cwd.')
        .option('--cargo-dir <path>', 'Cargo crate directory to resolve. Defaults to package root.')
        .option('--log-level <level>', 'trace | debug | info | warn | error. Default: info.')
        .action(async (opts: { cwd?: string; cargoDir?: string; logLevel?: string }) => {
            setLogLevel(parseLogLevel(opts.logLevel));
            await resolveDependencies({ cwd: opts.cwd, cargoDir: opts.cargoDir });
        });

    await program.parseAsync(process.argv);
};

void main().catch((err: unknown) => {
    logger.error('build-utils-rust failed', err);
    process.exit(1);
});
