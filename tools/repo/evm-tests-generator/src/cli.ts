#!/usr/bin/env node
import { Command } from 'commander';
import { readFileSync } from 'node:fs';

import { EVMBuildTarget } from '@layerzerolabs/common-evm';

import type { HardhatBuildInfo } from './parseArtifact';
import {
    ArtifactKind,
    detectArtifactKind,
    detectBuildInfoTarget,
    extractTestOptions,
} from './parseArtifact';
import { type BytecodeTarget, extractFromBytecode } from './parseBytecode';

const isBytecodeTarget = (value: string): value is BytecodeTarget =>
    ['evm', 'zksync', 'tron'].includes(value);

const formatValue = (value: unknown, depth: number): string => {
    const pad = ' '.repeat(depth * 4);
    const inner = ' '.repeat((depth + 1) * 4);
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value !== 'object' || value === null) return String(value);
    const entries = Object.entries(value).map(
        ([k, v]) => `${inner}${k}: ${formatValue(v, depth + 1)},`,
    );
    return `{\n${entries.join('\n')}\n${pad}}`;
};

const main = () => {
    const program = new Command();

    program
        .name('evm-tests-generator')
        .description('Tools for extracting EVM artifact snapshot settings.');

    program
        .command('artifact')
        .description(
            'Reads a Foundry output artifact, Hardhat build-info, or Hardhat\n' +
                'deployment artifact JSON and prints the ArtifactSnapshotSettings\n' +
                'values for use in test files.\n\n' +
                'ZKSync and Tron targets are auto-detected from solcLongVersion.',
        )
        .argument(
            '<artifact-path>',
            'Path to Foundry artifact, Hardhat build-info, or Hardhat deployment JSON',
        )
        .option(
            '-c, --contract-name <name>',
            'Required for Hardhat build-info artifacts to locate the bytecode',
        )
        .action((artifactPath: string, options: { contractName: string | undefined }) => {
            const content = readFileSync(artifactPath, 'utf-8');
            const json = JSON.parse(content) as Record<string, unknown>;
            const kind = detectArtifactKind(json);

            if (kind === ArtifactKind.HARDHAT_BUILD_INFO && options.contractName == null) {
                program.error('--contract-name is required for Hardhat build-info artifacts.');
            }

            const opts = extractTestOptions(content, options.contractName);

            const target =
                kind === ArtifactKind.HARDHAT_BUILD_INFO
                    ? detectBuildInfoTarget(json as HardhatBuildInfo)
                    : EVMBuildTarget.DEFAULT;

            console.log(
                `// Detected artifact kind: ${kind}${target !== EVMBuildTarget.DEFAULT ? `, target: ${target}` : ''}`,
            );
            console.log(formatValue(opts, 0));
        });

    program
        .command('bytecode')
        .description(
            'Computes bytecodeHash and metadata from raw bytecode hex.\n' +
                'Accepts a hex string (with or without 0x prefix).\n\n' +
                'Use --target zksync for EraVM bytecodes.\n' +
                'Use --deployed when the hex is runtime (deployed) bytecode, which emits\n' +
                'deployedBytecodeHash instead of bytecodeHash.\n' +
                '--deployed is not supported with --target zksync.',
        )
        .argument('<hex>', 'Raw creation or deployed bytecode hex string')
        .option('-t, --target <target>', 'Build target: evm (default), zksync, or tron', 'evm')
        .option(
            '-d, --deployed',
            'Input is deployed (runtime) bytecode. Emits deployedBytecodeHash.',
            false,
        )
        .action((hex: string, options: { target: string; deployed: boolean }) => {
            if (!isBytecodeTarget(options.target)) {
                return program.error(
                    `Invalid target '${options.target}'. Must be evm, zksync, or tron.`,
                );
            }
            const result = extractFromBytecode(hex, {
                target: options.target,
                deployed: options.deployed,
            });
            console.log(formatValue(result, 0));
        });

    program.parse();
};

main();
