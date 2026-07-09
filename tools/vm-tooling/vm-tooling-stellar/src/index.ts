import type { ChainContext } from '@layerzerolabs/vm-tooling';
import { runCli } from '@layerzerolabs/vm-tooling';

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
                'Reproducible `stellar contract build` of the self-contained source in the cwd, ' +
                    'inside the official stellar/stellar-cli:<stellar>-rust<rust>-slim-bookworm image ' +
                    'pinned by its linux/amd64 digest (run from the host, no Docker socket; embeds ' +
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
                    }: { stellarVersion: string; rustVersion: string },
                ) =>
                    verifiableBuildWrapper.run(
                        args,
                        { stellarVersion, rustVersion },
                        await parseGlobalOptions(program),
                    ),
            );
    });
