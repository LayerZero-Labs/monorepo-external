import { Command } from 'commander';
import { camelCase } from 'es-toolkit';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import type { EnvironmentVariable, VolumeMapping } from './config';
import { volumeMappingSchema } from './config';
import type { ChainContext } from './context';
import type { ToolCommandExecutionOptions } from './core';
import { executeToolCommand } from './core';
import { displayToolVersionInfo, displayVersionCombinations } from './display';
import { getToolDefaultVersion, getToolSupportedVersions } from './utils/finder';

interface GlobalOptions {
    cwd?: string;
    volume: VolumeMapping[];
    env: EnvironmentVariable[];
    script?: string;
    customEntrypoint?: string;
}

type RegisterExtraCommands = (
    program: Command,
    parseGlobalOptions: (command: Command) => ToolCommandExecutionOptions,
) => void;

const createCli = <TImageId extends string>(
    context: ChainContext<TImageId>,
    registerExtraCommands?: RegisterExtraCommands,
): Command => {
    const { tools } = context;
    const toolVersionOptions = Object.fromEntries(
        tools.map(({ name }) => [`${camelCase(name)}Version`, name]),
    );

    const parseGlobalOptions = (command: Command): ToolCommandExecutionOptions => {
        const { cwd, volume, ...options } = command.opts<GlobalOptions>();

        return {
            ...options,
            cwd: cwd ?? process.cwd(),
            volumes: volume,
            versions: Object.fromEntries(
                Object.entries(options)
                    .map(([name, version]) => [toolVersionOptions[name], version])
                    .filter(([tool]) => tool),
            ),
        };
    };

    const program = new Command();

    program
        .name('lz-tool')
        .description(
            '🚀 LayerZero VM tooling with intelligent version management\n' +
                '\n' +
                'Usage pattern:\n' +
                '  lz-tool [global-options] <tool> [tool-args...]\n' +
                '\n' +
                'Examples:\n' +
                '  lz-tool -e bash sui --help\n' +
                '  lz-tool --sui-version 1.38.0 sui client\n' +
                '\n' +
                'Note: All lz-tool options must appear BEFORE the tool name.',
        )
        .version('1.0.0')
        .enablePositionalOptions(); // Required for passThroughOptions to work

    // Check for --list-versions before parsing to avoid help display
    if (process.argv.includes('--list-versions')) {
        displayVersionCombinations(context);
        process.exit(0);
    }

    // Add global options.
    program
        .option('-c, --cwd <path>', 'Current working directory', (input: string) => {
            if (typeof input !== 'string') {
                throw new Error('cwd flag must be a string');
            }

            if (!path.isAbsolute(input)) {
                throw new Error('cwd must be an absolute path if provided');
            }

            if (!fs.existsSync(input)) {
                throw new Error('cwd does not exist');
            }

            if (!fs.statSync(input).isDirectory()) {
                throw new Error('cwd must be a directory');
            }

            return input;
        })
        .option(
            '-e, --custom-entrypoint <entrypoint>',
            'Override the default Docker entrypoint for the tool',
        )
        .option(
            '--script <script>',
            'Execute a custom script using bash -c in the Docker container (e.g., --script "npm install && npm test")',
        )
        .option(
            '--env <name=value>',
            'Set environment variables for Docker container (e.g., --env NODE_ENV=production)',
            (input: string, variables: EnvironmentVariable[]) => {
                const [name, ...valueParts] = input.split('=');

                if (!name || !valueParts.length) {
                    throw new Error(
                        `Invalid environment variable format: ${input}. Use --env NAME=VALUE`,
                    );
                }

                return [...variables, { name, value: valueParts.join('=') }];
            },
            [],
        )
        .option(
            '-v, --volume <type:hostPath:containerPath[:name]>',
            'Volume mappings in the format type:hostPath:containerPath[:name] (e.g., host:/host/path:/container/path or isolate::/container/path:volumeName)',
            (input: string, volumes: VolumeMapping[]) => {
                const [type, hostPath, containerPath, name] = input.split(':');

                switch (type) {
                    case 'host':
                        if (!hostPath) {
                            throw new Error(`Host path is required for volume type 'host'`);
                        }
                        break;
                    case 'isolate':
                        if (!name) {
                            throw new Error(`Name is required for volume type 'isolate'`);
                        }
                        break;
                    default:
                        throw new Error(`Invalid volume type: ${type}`);
                }

                if (!containerPath) {
                    throw new Error(`Container path is required`);
                }

                return [
                    ...volumes,
                    volumeMappingSchema.parse({ type, hostPath, containerPath, name }),
                ];
            },
            [],
        )
        .option(
            '-p, --publish <host_port:container_port>',
            "Publish a container's port(s) to the host",
        );

    // Add version options for each tool dynamically
    for (const tool of tools) {
        const defaultVersion = getToolDefaultVersion(context, tool.name);
        const supportedVersions = getToolSupportedVersions(context, tool.name);

        program.option(
            `--${tool.name}-version <version>`,
            `Specify ${tool.name} version (default: ${defaultVersion}, supported: ${supportedVersions.join(', ')})`,
        );
    }

    // Add utility options
    program.option('--list-versions', 'Display all supported version combinations and exit');

    // Add version info command
    program
        .command('version-info <tool>')
        .description('Display detailed version information for a specific tool')
        .action((toolName: string) => displayToolVersionInfo(context, toolName));

    for (const tool of tools) {
        // Don't add any options to the subcommand level.
        // All lz-tool options must be specified before the subcommand.
        program
            .command(tool.name, { isDefault: false })
            .description(`Run ${tool.name} with version checking`)
            .passThroughOptions(true) // Pass through all options after the subcommand
            .allowUnknownOption()
            .helpOption(false) // Disable automatic help option to pass --help to the tool
            .argument('[args...]', 'Arguments to pass to the tool')
            .action(async (args: string[]) => {
                await executeToolCommand(context, tool.name, args, parseGlobalOptions(program));
            });
    }

    // Allow external registration of extra commands
    registerExtraCommands?.(program, parseGlobalOptions);

    return program;
};

export const runCli = async <TImageId extends string>(
    config: ChainContext<TImageId>,
    registerExtraCommands?: RegisterExtraCommands,
): Promise<void> => {
    try {
        await createCli<TImageId>(config, registerExtraCommands).parseAsync();
    } catch (error) {
        console.error('❌ VM tool execution failed', error);
        process.exit(1);
    }
};
