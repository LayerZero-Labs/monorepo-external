#!/usr/bin/env tsx
import { runCodeFormatters } from '@layerzerolabs/repo-utils';
import { type ArgumentConfig, parse } from '@layerzerolabs/ts-command-line-args';

import { generateTsArtifacts } from './generateTsArtifacts';

interface GeneratorCliArgs {
    path: string;
}

const commandArgs: ArgumentConfig<GeneratorCliArgs> = {
    path: {
        alias: 'p',
        type: String,
        description: 'path to the package directory',
    },
};

const main = async (): Promise<void> => {
    const { path } = parse<GeneratorCliArgs>(commandArgs);

    try {
        console.log(
            `📦 Generating strictly typed artifacts for EVM, Tron and ZkSync contracts for package: ${path}`,
        );

        await generateTsArtifacts(path);

        await runCodeFormatters([path], path);
    } catch (err) {
        console.error(`❌ TS artifacts generation failed for package: ${path}`, err);
        process.exit(1);
    }
};

main().catch((error) => {
    console.error('❌ Unhandled error:', error);
    process.exit(1);
});
