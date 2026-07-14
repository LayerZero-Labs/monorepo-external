import type { ChainContext } from '@layerzerolabs/vm-tooling';
import { runCli } from '@layerzerolabs/vm-tooling';

import { packageSource } from './commands/package-source';
import { syncToolchain } from './commands/sync-toolchain';
import { VerifiableBuildWrapper } from './commands/verifiable-build';
import { type ImageId, images, tools, versionCombinations } from './config';

const context: ChainContext<ImageId> = { tools, images, versionCombinations };

const verifiableBuildWrapper = new VerifiableBuildWrapper();

export const main = (): Promise<void> =>
    runCli(context, (program, parseGlobalOptions) => {
        program
            .command('sync-toolchain')
            .description(
                'Pre-download the Rust toolchain specified in rust-toolchain.toml under a lock',
            )
            .action(async () => syncToolchain(context, await parseGlobalOptions(program)));

        // Extra (non-passthrough) commands, namespaced under `extra <tool>` like vm-tooling-sui:
        //   lz-tool extra stellar verifiable-build [args...]
        const extra = program.command('extra').description('Extra commands for VM tooling');
        const stellar = extra.command('stellar');

        stellar
            .command('verifiable-build')
            .description(
                'Reproducible `stellar contract build` of the self-contained source in the cwd by ' +
                    'default, inside the official stellar/stellar-cli:<stellar>-rust<rust>-slim-bookworm ' +
                    'image pinned by its linux/amd64 digest (run from the host, no Docker socket; embeds ' +
                    'the bldimg WASM meta automatically)',
            )
            .requiredOption(
                '--stellar-version <version>',
                'Stellar CLI version of the official reproducible image (e.g. 25.1.0)',
            )
            .requiredOption(
                '--rust-version <version>',
                'Rust version of the official reproducible image (e.g. 1.90.0)',
            )
            .option(
                '--source-dir <path>',
                'Directory to build — the self-contained/decompressed source. Relative paths ' +
                    'resolve against the cwd; defaults to the cwd.',
            )
            .argument(
                '[args...]',
                'Arguments for `stellar contract build`, after `--` (e.g. -- --package <crate>)',
            )
            .passThroughOptions(true)
            .allowUnknownOption()
            .action(
                async (
                    args: string[],
                    {
                        stellarVersion,
                        rustVersion,
                        sourceDir,
                    }: { stellarVersion: string; rustVersion: string; sourceDir?: string },
                ) =>
                    verifiableBuildWrapper.run(
                        args,
                        { stellarVersion, rustVersion },
                        await parseGlobalOptions(program),
                        sourceDir,
                    ),
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
