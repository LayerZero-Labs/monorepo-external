import { runCli } from '@layerzerolabs/vm-tooling';

import * as starknetCommands from './commands/starknet';
import { images, tools, versionCombinations } from './config';

export const main = (): Promise<void> =>
    runCli({ tools, images, versionCombinations }, (program) => {
        const extra = program.command('extra').description('Extra commands for VM tooling');

        extra
            .command('starknet')
            .command('build-typescript-sdk')
            .description('Generate TypeScript SDK for Starknet')
            .argument('<package-name>', 'Scarb package name')
            .argument('<target-directory>', 'Scarb target directory')
            .argument('<src-directory>', 'TypeScript source directory')
            .action(starknetCommands.buildTypescriptSdk);
    });
