#!/usr/bin/env tsx

import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';

import { type ContractSizesOutput, getContractSizes } from './index';

const VM_DISPLAY_NAMES: Record<string, string> = {
    evm: 'EVM',
    tron: 'Tron',
    zksync: 'ZKsync',
};

// EIP-170: max runtime bytecode = 24 KB, EIP-3860: max initcode = 48 KB.
const MAX_RUNTIME_SIZE = 24 * 1024;
const MAX_INITCODE_SIZE = 48 * 1024;
const SIZE_LIMITED_VMS = new Set(['evm', 'tron']);

const printTable = (output: ContractSizesOutput): void => {
    const contractNames = Object.keys(output);
    if (contractNames.length === 0) return;

    // Collect all unique VM names across contracts, preserving insertion order.
    const vms = [...new Set(contractNames.flatMap((name) => Object.keys(output[name])))];

    // Build a record keyed by contract name with flat columns for `console.table`.
    const table: Record<string, Record<string, number>> = {};
    for (const name of contractNames) {
        const row: Record<string, number> = {};
        for (const vm of vms) {
            const display = VM_DISPLAY_NAMES[vm] ?? vm;
            const entry = output[name][vm];
            row[`${display} runtime`] = entry?.runtimeSize ?? 0;
            row[`${display} initcode`] = entry?.initcodeSize ?? 0;
        }
        table[name] = row;
    }

    console.log('');
    console.table(table);
};

const serialize = (output: ContractSizesOutput): string => JSON.stringify(output, null, 4) + '\n';

const main = async () => {
    const cwd = process.cwd();
    const isCI = process.env.CI === 'true';

    console.log(`${isCI ? 'Verifying' : 'Inspecting'} contract sizes in ${cwd}`);

    const { output, outputFile } = await getContractSizes(cwd);
    const outputPath = path.resolve(cwd, outputFile);
    const expected = serialize(output);

    // In CI, snapshot the existing file before overwriting to verify correctness.
    let existing: string | undefined;
    if (isCI) {
        try {
            existing = await readFile(outputPath, 'utf-8');
        } catch {
            printTable(output);
            console.error(
                `\n${outputFile} does not exist. Run \`pnpm contract-sizes\` to generate it.`,
            );
            process.exit(1);
        }
    }

    // Write output file.
    await writeFile(outputPath, expected);

    // Print table to stdout.
    printTable(output);

    // In CI, fail if the committed file was out of date (the correct version has already been written).
    if (existing !== undefined && existing !== expected) {
        console.error(
            `\n${outputFile} was out of date and has been updated. Please commit the changes.`,
        );
        process.exit(1);
    }

    const contractCount = Object.keys(output).length;
    if (contractCount === 0) {
        console.log('\nNo contracts with bytecode found. Have you compiled the contracts?');
    } else {
        // Warn about contracts exceeding EVM size limits.
        const warnings: string[] = [];
        for (const [name, vms] of Object.entries(output)) {
            for (const [vm, sizes] of Object.entries(vms)) {
                if (!SIZE_LIMITED_VMS.has(vm)) continue;
                const display = VM_DISPLAY_NAMES[vm] ?? vm;
                if (sizes.runtimeSize > MAX_RUNTIME_SIZE) {
                    warnings.push(
                        `  ${name} (${display}): runtime size ${sizes.runtimeSize} bytes exceeds 24 KB limit (${MAX_RUNTIME_SIZE} bytes)`,
                    );
                }
                if (sizes.initcodeSize > MAX_INITCODE_SIZE) {
                    warnings.push(
                        `  ${name} (${display}): initcode size ${sizes.initcodeSize} bytes exceeds 48 KB limit (${MAX_INITCODE_SIZE} bytes)`,
                    );
                }
            }
        }

        // We can consider throwing an error here.
        if (warnings.length > 0) {
            console.warn(
                `\nWARNING: The following contracts exceed size limits:\n${warnings.join('\n')}`,
            );
        }

        console.log(`\nContract sizes written to ${outputPath}`);
    }
};

main().catch((err: unknown) => {
    console.error('Error:', err);
    process.exit(1);
});
