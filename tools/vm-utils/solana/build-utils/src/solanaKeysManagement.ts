import { Keypair } from '@solana/web3.js';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';

import { getFullyQualifiedRepoRootPath, pathExists } from './utils/files';

type KeysMapping = Record<string, string[]>;

// duplicated from `@layerzerolabs/common-solana` to simplify compilation package graph
const getDefaultKeysPathFromResolvedPackagePath = (resolvedPackagePath: string) =>
    path.join(resolvedPackagePath, 'default-solana-keys');

const getKeysPathFromResolvedPackagePath = (resolvedPackagePath: string) =>
    path.join(resolvedPackagePath, 'solana-keys');

export const getSolanaKeysFromGenerated = async ({
    keysNeeded,
    resolvedPackagePath,
}: {
    keysNeeded: KeysMapping;
    resolvedPackagePath: string;
}) => {
    const keys: Record<string, Record<string, string>> = {};

    for (const contractName of Object.keys(keysNeeded)) {
        const customKeysDir = getKeysPathFromResolvedPackagePath(resolvedPackagePath);
        const defaultKeysDir = getDefaultKeysPathFromResolvedPackagePath(resolvedPackagePath);
        const hasKeys = fsSync.existsSync(customKeysDir);
        const keysDir = hasKeys ? customKeysDir : defaultKeysDir;

        const filepath = path.join(keysDir, `${contractName}.json`);

        const keyData: Record<string, number[] | string> = JSON.parse(
            await fs.readFile(filepath, 'utf-8'),
        );

        keys[contractName] = {};
        for (const baseName of keysNeeded[contractName]) {
            const keypairArray = keyData[`${baseName}Keypair`];
            if (Array.isArray(keypairArray)) {
                keys[contractName][`${baseName}Keypair`] = Keypair.fromSecretKey(
                    new Uint8Array(keypairArray),
                ).publicKey.toBase58();
            } else if (typeof keyData[`${baseName}PublicKey`] === 'string') {
                keys[contractName][`${baseName}Keypair`] = keyData[
                    `${baseName}PublicKey`
                ] as string;
            }
        }
    }

    return keys;
};

// TODO: Add a `setPublicKey` command to keysManagement.ts entry points that accepts
// a contract name, key name, and base58 public key, then writes a pubkey-only JSON file
// (e.g., {"escrowPublicKey": "<base58>"}) to solana-keys/. Reading is already supported
// in getSolanaKeysFromGenerated.
export const generateAndSaveSolanaKeys = async ({
    keysNeeded,
    defaultKeys,
    resolvedPackagePath,
}: {
    keysNeeded: KeysMapping;
    // whether the outputted keys should be used as the `default keys`, i.e., insecure
    defaultKeys: boolean;
    resolvedPackagePath: string;
}) => {
    const keys: Record<string, Record<string, Array<number> | string>> = {};

    for (const contractName of Object.keys(keysNeeded)) {
        const keysToAdd = keysNeeded[contractName];
        keys[contractName] = {};

        for (const key of keysToAdd) {
            console.log(`Generating new keypair for ${key} in ${contractName}`);

            const keypair = Keypair.generate();
            keys[contractName][`${key}Keypair`] = Array.from(keypair.secretKey);
            keys[contractName][`${key}PublicKey`] = keypair.publicKey.toBase58();
        }
    }

    const contracts = Object.keys(keys);

    const outdir = defaultKeys
        ? getDefaultKeysPathFromResolvedPackagePath(resolvedPackagePath)
        : getKeysPathFromResolvedPackagePath(resolvedPackagePath);

    await fs.rm(outdir, { recursive: true, force: true });
    await fs.mkdir(outdir, { recursive: true });

    await Promise.all(
        contracts.map((contract) =>
            fs.writeFile(path.join(outdir, `${contract}.json`), JSON.stringify(keys[contract])),
        ),
    );
};

const moveFolder = async (src: string, dest: string) => {
    await fs.mkdir(dest, { recursive: true });

    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            await moveFolder(srcPath, destPath);
        } else {
            await fs.rename(srcPath, destPath);
        }
    }
    await fs.rmdir(src);
};

export const removeSolanaKeys = async ({
    resolvedPackagePath,
}: {
    resolvedPackagePath: string;
}) => {
    const repoRoot = await getFullyQualifiedRepoRootPath();
    const backUpFolder = path.join(repoRoot, '.solana-keys-backup');
    const keysDir = getKeysPathFromResolvedPackagePath(resolvedPackagePath);
    if (!(await pathExists(keysDir))) {
        console.log(`Keys directory ${keysDir} does not exist, skipping backup`);
        return;
    }

    const relativePath = path.relative(repoRoot, keysDir);
    const backUpKeysDir = path.join(backUpFolder, relativePath, `${Date.now()}`);
    await moveFolder(keysDir, backUpKeysDir);
};
