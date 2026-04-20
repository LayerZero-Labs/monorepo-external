import { runCli } from '@layerzerolabs/vm-tooling';

import { syncToolchain } from './commands/sync-toolchain';
import { images, tools, versionCombinations } from './config';

const context = { tools, images, versionCombinations };

export const main = (): Promise<void> =>
    runCli(context, (program, parseGlobalOptions) => {
        program
            .command('sync-toolchain')
            .description(
                'Pre-download the Rust toolchain specified in rust-toolchain.toml under a lock',
            )
            .action(async () => syncToolchain(context, await parseGlobalOptions(program)));
    });
