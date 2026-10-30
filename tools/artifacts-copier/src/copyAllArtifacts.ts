#!/usr/bin/env tsx
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';

import { parse } from '@layerzerolabs/args';
import { ChainName, ChainType } from '@layerzerolabs/layerzero-definitions';

import { copyDir } from './copyDir';
import { copyEvmContractArtifacts, copyZkSyncContractArtifacts } from './copyEvmContractArtifacts';
import { copySolanaContractArtifacts } from './copySolanaContractArtifacts';
import { copyStarknetContractArtifacts } from './copyStarknetContractArtifacts';
import { copyTonContractArtifacts, postGenerateOperationsTon } from './copyTonContractArtifacts';
import { copyTronContractArtifacts } from './copyTronContractArtifacts';
import type { ArtifactPackagesConfig, ContractConfig, PostGenerateOperationsInput } from './types';

const args = parse({
    header: 'Copy contract artifacts based on configuration file',
    args: {
        config: {
            alias: 'c',
            type: String,
            description: 'Path to artifactPackages.config.json file',
            defaultValue: './src/artifactPackages.config.json',
        },
    },
});

function validateContractFormat(
    contract: unknown,
    packageName: string,
    target?: string,
): asserts contract is ContractConfig {
    // Check if contract is an object
    if (typeof contract !== 'object' || contract === null) {
        throw new Error(
            `Invalid contract in package '${packageName}': expected object, got ${typeof contract}. ` +
                `Each contract must be an object with a 'name' property.`,
        );
    }

    const contractObj = contract as Record<string, unknown>;

    // Ensure name property exists and is non-empty string
    if (
        !('name' in contractObj) ||
        typeof contractObj.name !== 'string' ||
        contractObj.name.trim() === ''
    ) {
        throw new Error(
            `Invalid contract in package '${packageName}': 'name' property is required and must be a non-empty string. ` +
                `Got: ${JSON.stringify(contract)}`,
        );
    }

    // For TON, also check that file property exists and is non-empty string
    if (target === ChainType.TON) {
        if (
            !('file' in contractObj) ||
            typeof contractObj.file !== 'string' ||
            contractObj.file.trim() === ''
        ) {
            throw new Error(
                `Invalid TON contract '${contractObj.name}' in package '${packageName}': ` +
                    `'file' property is required for TON contracts. Got: ${JSON.stringify(contract)}`,
            );
        }
    }
}

async function _checkIfFileExists(path: string): Promise<boolean> {
    return fs.promises
        .stat(path)
        .then(() => true)
        .catch(() => false);
}

const postGenerateOperations = async (input: PostGenerateOperationsInput) => {
    if (input.targets.includes(ChainType.TON)) {
        await postGenerateOperationsTon(input);
    }
};

export const copyAllArtifacts = async () => {
    const configPath = path.resolve(args.config);
    const configDir = path.dirname(configPath);
    // The package root is the parent of the config directory (src)
    const packageRoot = path.dirname(configDir);

    if (!(await _checkIfFileExists(configPath))) {
        throw new Error(`Config file not found at: ${configPath}`);
    }

    const configContent = await fs.promises.readFile(configPath, 'utf-8');
    const artifactsPackageConfig: ArtifactPackagesConfig = JSON.parse(configContent);

    const chainTypes = artifactsPackageConfig.config?.byChainType || [];
    const chainNames = artifactsPackageConfig.config?.byChainName || [];
    const directories = artifactsPackageConfig.directories || {};
    const contracts = artifactsPackageConfig.contracts || {};
    const hasDirectories = Object.keys(directories).length > 0;

    const targets = [...chainTypes, ...chainNames];

    if (targets.length === 0 && !hasDirectories) {
        throw new Error('Failed to copy artifacts, no chains nor dirs specified');
    }

    // Create require function for resolving package paths
    const packageJsonPath = path.join(packageRoot, 'package.json');
    const req = createRequire(packageJsonPath);
    const resolvePath = (relativePathWithinPackage: string) =>
        req.resolve(relativePathWithinPackage);

    if (!contracts && !hasDirectories) {
        throw new Error('No contracts or directories specified in config file');
    }

    // Process all contracts in parallel
    const copyPromises = Object.entries(contracts).flatMap(([packageName, contracts]) =>
        contracts.flatMap((contract) =>
            targets.map((target) => {
                // Validate contract format before processing
                validateContractFormat(contract, packageName, target);

                if (target === ChainType.EVM) {
                    return copyEvmContractArtifacts(
                        resolvePath,
                        packageRoot,
                        packageName,
                        contract.name,
                        contract.file,
                    );
                } else if (target === ChainName.ZKSYNC) {
                    // there are other zkSync chains, using one in config is enough.
                    return copyZkSyncContractArtifacts(
                        resolvePath,
                        packageRoot,
                        packageName,
                        contract.name,
                        contract.file,
                    );
                } else if (target === ChainName.TRON) {
                    return copyTronContractArtifacts(
                        resolvePath,
                        packageRoot,
                        packageName,
                        contract.name,
                        contract.file,
                    );
                } else if (target === ChainName.SOLANA) {
                    return copySolanaContractArtifacts(
                        resolvePath,
                        packageRoot,
                        packageName,
                        contract.name,
                        contract.rename,
                        contract.isVerifiable,
                    );
                } else if (target === ChainType.STARKNET) {
                    return copyStarknetContractArtifacts({
                        resolvePath,
                        packageRoot,
                        packageName,
                        scarbPackage: contract.name,
                    });
                } else if (target === ChainType.TON) {
                    return copyTonContractArtifacts(
                        resolvePath,
                        packageRoot,
                        packageName,
                        contract,
                    );
                } else {
                    throw new Error(
                        `Unsupported chain provided in artifactsconfig: ${target} for package: ${packageName} and contract: ${contract.name}`,
                    );
                }
            }),
        ),
    );

    await Promise.all(copyPromises);

    await postGenerateOperations({ resolvePath, packageRoot, targets, artifactsPackageConfig });

    console.log(`✅ Successfully copied artifacts for ${copyPromises.length} contract(s)`);

    const copyDirPromises = Object.entries(directories)
        .map(([packageName, dirs]) => {
            return dirs.map((dir) => copyDir(resolvePath, packageRoot, packageName, dir));
        })
        .flat();

    await Promise.all(copyDirPromises);

    console.log(`✅ Successfully copied * for ${copyDirPromises.length} directory(ies)`);
};

copyAllArtifacts().catch((err) => {
    console.error('❌ Failed to copy artifacts:', err);
    process.exitCode = 1;
});
