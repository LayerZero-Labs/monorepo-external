import path from 'node:path';

import type { ChainContext } from '@layerzerolabs/vm-tooling';
import { runCli } from '@layerzerolabs/vm-tooling';

import { packageSource } from './commands/package-source';
import { syncToolchain } from './commands/sync-toolchain';
import { parsePackageSpec, runVerifiableBuildFromArchive } from './commands/verifiable-build';
import { type ImageId, images, tools, versionCombinations } from './config';

const DEFAULT_OUTPUT_DIR = '.artifacts';

export { createStellarScopedWorkspacePruner } from './scoped-workspace-pruner';

const context: ChainContext<ImageId> = { tools, images, versionCombinations };

const collectPackageSpecs = (value: string, previous: string[]): string[] => [...previous, value];

export const main = (): Promise<void> =>
    runCli(context, (program, parseGlobalOptions) => {
        program
            .command('sync-toolchain')
            .description(
                'Pre-download the Rust toolchain specified in rust-toolchain.toml under a lock',
            )
            .action(async () => syncToolchain(context, await parseGlobalOptions(program)));

        // Extra (non-passthrough) commands, namespaced under `extra <tool>` like vm-tooling-sui:
        //   lz-tool extra stellar verifiable-build [options]
        const extra = program.command('extra').description('Extra commands for VM tooling');
        const stellar = extra.command('stellar');

        stellar
            .command('verifiable-build')
            .description(
                'Build one or more Stellar contracts reproducibly from a source archive: ' +
                    'extract → hash → build each --package in the official stellar/stellar-cli ' +
                    'image → atomically publish contracts-source.zip and *.wasm.',
            )
            .requiredOption(
                '--stellar-version <version>',
                'Stellar CLI version of the official reproducible image (e.g. 25.1.0)',
            )
            .option(
                '--rust-version <version>',
                'Rust version of the official reproducible image (e.g. 1.90.0); defaults to ' +
                    "the archive's rust-toolchain.toml channel",
            )
            .requiredOption(
                '--archive <path>',
                'Self-contained source .zip for the SEP-58 verifiable build',
            )
            .option(
                '--package <name:manifest>',
                'Package to build as <name>:<manifest-path> (repeatable; required at least once)',
                collectPackageSpecs,
                [] as string[],
            )
            .option(
                '--output-dir <path>',
                'Directory for contracts-source.zip and *.wasm',
                DEFAULT_OUTPUT_DIR,
            )
            .action(
                async ({
                    stellarVersion,
                    rustVersion,
                    archive,
                    package: packageSpecs,
                    outputDir,
                }: {
                    stellarVersion: string;
                    rustVersion?: string;
                    archive: string;
                    package: string[];
                    outputDir: string;
                }) => {
                    const options = await parseGlobalOptions(program);
                    await runVerifiableBuildFromArchive(
                        {
                            archive: path.resolve(options.cwd, archive),
                            packages: packageSpecs.map(parsePackageSpec),
                            outputDir: path.resolve(options.cwd, outputDir),
                            stellarVersion,
                            rustVersion,
                        },
                        { cwd: options.cwd },
                    );
                },
            );

        stellar
            .command('package-source')
            .description(
                'Package the self-contained crate in the cwd into a byte-deterministic source ' +
                    '.zip under .artifacts/ (for the SEP-58 verifiable build) and print its ' +
                    'source_sha256. Include-only: packages source files (.rs/.lock, Cargo.toml, ' +
                    'rust-toolchain.toml, rustfmt.toml, clippy.toml) plus any --include entries; ' +
                    '--exclude always wins. Skips non-source directories (target, node_modules, …).',
            )
            .option(
                '--output <path>',
                'Output .zip path (default: <cwd>/.artifacts/<basename>-source.zip)',
            )
            .option(
                '--include <pattern...>',
                'Native Node glob patterns to include beyond the default source extensions',
                [],
            )
            .option(
                '--exclude <pattern...>',
                'Native Node glob patterns to exclude (always wins over the allow-list and --include)',
                [],
            )
            .action(
                async ({
                    output,
                    include,
                    exclude,
                }: {
                    output?: string;
                    include?: string[];
                    exclude?: string[];
                }) =>
                    packageSource({ output, include, exclude }, await parseGlobalOptions(program)),
            );
    });
