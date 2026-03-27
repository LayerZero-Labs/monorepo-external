import type { Dirent } from 'fs';
import { readdir, readFile, stat } from 'fs/promises';
import * as path from 'path';

export type ContractSizesConfig = {
    /** Contract names to measure. Default: auto-discover from `contractsDir`. */
    contracts?: string[];
    /**
     * Artifact directories to scan, keyed by VM name.
     * Default: `{ evm: 'artifacts/contracts', tron: 'artifacts-tron/contracts', zksync: 'artifacts-zk/contracts' }`.
     */
    artifactDirs?: Record<string, string>;
    /** Source contracts directory used for auto-discovery. Default: `contracts`. */
    contractsDir?: string;
    /** Output file path. Default: `contract-sizes.json`. */
    output?: string;
};

export type ContractSizeEntry = {
    runtimeSize: number;
    initcodeSize: number;
};

/** Keyed by contract name, then by VM name */
export type ContractSizesOutput = Record<string, Record<string, ContractSizeEntry>>;

// Hardhat outputs artifacts under `<artifactsDir>/contracts/`.
// Foundry outputs directly under `<artifactsDir>/ContractName.sol/`.
// We target the Hardhat path to avoid picking up Foundry duplicates.
const DEFAULT_ARTIFACT_DIRS: Record<string, string> = {
    evm: 'artifacts/contracts',
    tron: 'artifacts-tron/contracts',
    zksync: 'artifacts-zk/contracts',
};

const DEFAULT_CONTRACTS_DIR = 'contracts';
const DEFAULT_OUTPUT = 'contract-sizes.json';

/**
 * Count the number of bytes represented by a hex-encoded bytecode string.
 * Handles "0x"-prefixed and bare hex strings.
 */
export const countBytes = (bytecodeHex: string | undefined | null): number => {
    if (!bytecodeHex || bytecodeHex === '0x' || bytecodeHex === '0x0') return 0;
    const hex = bytecodeHex.startsWith('0x') ? bytecodeHex.slice(2) : bytecodeHex;
    return Math.ceil(hex.length / 2);
};

/**
 * Extract the hex string from a bytecode field that may be either:
 *  - A plain hex string (Hardhat / abiBytecode format).
 *  - An object with an `object` property (Foundry format).
 */
export const extractBytecodeHex = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'object' in value) {
        const obj = value as Record<string, unknown>;
        if (typeof obj.object === 'string') return obj.object;
    }
    return undefined;
};

/**
 * Recursively collect all `.json` file paths under `dir`, skipping
 * `build-info` directories and `.dbg.json` debug files.
 */
const walkJsonFiles = async (dir: string): Promise<string[]> => {
    const results: string[] = [];

    let entries: Dirent[];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (entry.name === 'build-info') continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...(await walkJsonFiles(fullPath)));
        } else if (
            entry.isFile() &&
            entry.name.endsWith('.json') &&
            !entry.name.endsWith('.dbg.json')
        ) {
            results.push(fullPath);
        }
    }

    return results;
};

/**
 * Recursively discover contract names from `.sol` files under `contractsDir`.
 */
const discoverContractNames = async (contractsDir: string): Promise<string[]> => {
    const names: string[] = [];

    const walk = async (dir: string): Promise<void> => {
        let entries: Dirent[];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.sol')) {
                names.push(path.basename(entry.name, '.sol'));
            }
        }
    };

    await walk(contractsDir);
    return [...new Set(names)];
};

const dirExists = async (dirPath: string): Promise<boolean> => {
    try {
        const s = await stat(dirPath);
        return s.isDirectory();
    } catch {
        return false;
    }
};

export const getContractSizes = async (
    cwd: string,
): Promise<{ output: ContractSizesOutput; outputFile: string }> => {
    const artifactDirs = DEFAULT_ARTIFACT_DIRS;
    const contractsDir = path.resolve(cwd, DEFAULT_CONTRACTS_DIR);
    const outputFile = DEFAULT_OUTPUT;

    // Determine which contract names to look for.
    const contractNames = await discoverContractNames(contractsDir);

    if (contractNames.length === 0) {
        console.warn('No contracts found to measure.');
        return { output: {}, outputFile };
    }

    const contractSet = new Set(contractNames);
    const output: ContractSizesOutput = {};

    for (const [vmName, artifactDirRel] of Object.entries(artifactDirs)) {
        const fullArtifactDir = path.resolve(cwd, artifactDirRel);

        if (!(await dirExists(fullArtifactDir))) continue;

        const jsonFiles = await walkJsonFiles(fullArtifactDir);

        for (const jsonFile of jsonFiles) {
            const fileName = path.basename(jsonFile, '.json');

            if (!contractSet.has(fileName)) continue;

            try {
                const content = await readFile(jsonFile, 'utf-8');
                const artifact: Record<string, unknown> = JSON.parse(content);

                // Skip files without bytecode fields (e.g. metadata, build-info, etc.)
                if (!artifact.bytecode && !artifact.deployedBytecode) continue;

                const bytecode = extractBytecodeHex(artifact.bytecode);
                const deployedBytecode = extractBytecodeHex(artifact.deployedBytecode);

                const initcodeSize = countBytes(bytecode);
                const runtimeSize = countBytes(deployedBytecode);

                // Skip entries where both sizes are zero (interfaces / abstract contracts)
                if (initcodeSize === 0 && runtimeSize === 0) continue;

                output[fileName] ??= {};
                output[fileName][vmName] = { runtimeSize, initcodeSize };
            } catch {
                // Skip files that cannot be parsed
                continue;
            }
        }
    }

    // Sort contracts alphabetically.
    const sorted = Object.keys(output)
        .sort()
        .reduce<ContractSizesOutput>((acc, key) => {
            acc[key] = output[key];
            return acc;
        }, {});

    return { output: sorted, outputFile };
};
