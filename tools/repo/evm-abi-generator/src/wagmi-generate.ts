#!/usr/bin/env tsx

import { type ArgumentConfig, parse } from '@layerzerolabs/ts-command-line-args';

import { generateWagmiBarrelExport } from './barrel-export';
import { generateWagmiWithBarrel } from './generate';

interface WagmiGenerateCliArgs {
    cfg?: string[];
    'skip-clean'?: boolean;
    'no-barrel'?: boolean;
    directory?: string;
    help?: boolean;
}

const commandArgs: ArgumentConfig<WagmiGenerateCliArgs> = {
    cfg: {
        alias: 'c',
        type: String,
        multiple: true,
        optional: true,
        description: 'Wagmi config file(s) to process (can specify multiple)',
    },
    'skip-clean': {
        type: Boolean,
        optional: true,
        defaultValue: false,
        description: 'Skip cleaning output directories before generating',
    },
    'no-barrel': {
        type: Boolean,
        optional: true,
        defaultValue: false,
        description: 'Skip barrel export generation',
    },
    directory: {
        type: String,
        optional: true,
        description: 'Directory to generate barrel export for (standalone mode)',
    },
    help: {
        alias: 'h',
        type: Boolean,
        optional: true,
        description: 'Show this help message',
    },
};

async function main(): Promise<void> {
    const args = parse<WagmiGenerateCliArgs>(commandArgs);

    // Handle help flag
    if (args.help) {
        console.log(`
wagmi-generate - Generate TypeScript types from Wagmi configs with barrel exports

USAGE:
  Config mode:     wagmi-generate --cfg <config> [options]
  Standalone mode: wagmi-generate --directory <dir>

OPTIONS:
  --cfg, -c          Wagmi config file(s) to process (can specify multiple)
  --skip-clean       Skip cleaning output directories before generating
  --no-barrel        Skip barrel export generation (only run wagmi generate)
  --directory        Directory to generate barrel export for (standalone mode)
  --help, -h         Show this help message

EXAMPLES:
  wagmi-generate --cfg ./wagmi.config.ts
  wagmi-generate --cfg ./wagmi.config.ts --skip-clean
  wagmi-generate --cfg ./wagmi.config.ts --no-barrel
  wagmi-generate --directory ./src/generated-abi
`);
        process.exit(0);
    }

    try {
        // Config mode: run wagmi generate + barrel exports
        if (args.cfg && args.cfg.length > 0) {
            if (args.directory) {
                console.warn(
                    '⚠️  --cfg mode detected. Ignoring --directory argument. Directories will be auto-detected from configs.',
                );
            }

            await generateWagmiWithBarrel({
                configs: args.cfg,
                clean: !args['skip-clean'],
                noBarrel: args['no-barrel'],
            });
        }
        // Standalone mode: just generate barrel export for specified directory
        else if (args.directory) {
            await generateWagmiBarrelExport(args.directory);
        }
        // No arguments provided
        else {
            console.error(
                '❌ Error: No directory or config specified.\n\n' +
                    'Usage:\n' +
                    '  Standalone: wagmi-generate --directory <dir>\n' +
                    '  Config:     wagmi-generate --cfg <config> [options]\n\n' +
                    'Options:\n' +
                    '  --skip-clean   Skip cleaning output directories before Abi generation\n' +
                    '  --no-barrel    Skip barrel export generation after Abi generation\n\n' +
                    'Run with --help for more information.',
            );
            process.exit(1);
        }
    } catch (error) {
        console.error('❌ Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
});
