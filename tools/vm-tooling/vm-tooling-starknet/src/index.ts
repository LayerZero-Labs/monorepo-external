import { runCli } from '@layerzerolabs/vm-tooling';

import * as starknetCommands from './commands/starknet';
import { images, tools, versionCombinations } from './config';

export { createStarknetScopedWorkspacePruner } from './scoped-workspace-pruner';

export const main = (): Promise<void> =>
    runCli({ tools, images, versionCombinations }, (program) => {
        const extra = program.command('extra').description('Extra commands for VM tooling');
        const starknet = extra.command('starknet');

        starknet
            .command('build-typescript-sdk')
            .description('Generate TypeScript SDK for Starknet')
            .argument('<scarb-package>', 'Scarb package name')
            .argument('<target-directory>', 'Scarb target directory')
            .argument('<src-directory>', 'TypeScript source directory')
            .action((scarbPackage: string, targetDirectory: string, srcDirectory: string) =>
                starknetCommands.buildTypescriptSdk({
                    scarbPackage,
                    targetDirectory,
                    srcDirectory,
                }),
            );
    });
