import { Keypair, PublicKey } from '@solana/web3.js';
import fsSync from 'fs';
import fs from 'fs/promises';
import path from 'path';
import z from 'zod';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';

export const getOneTimeDeploymentKeys = (): {
    bufferKp: Keypair;
    programKp: Keypair;
} => {
    const bufferKp = Keypair.generate();
    const programKp = Keypair.generate();

    return {
        bufferKp,
        programKp,
    };
};

export async function getAddressFromIDL(idlPath: string): Promise<string> {
    let idl: { address?: string };
    try {
        idl = JSON.parse(await fs.readFile(idlPath, 'utf8'));
    } catch (err) {
        throw new Error(
            `Failed to read IDL at ${idlPath}: ${err instanceof Error ? err.message : err}`,
        );
    }

    if (!idl?.address) {
        throw new NonRetryableError(`IDL file is missing the address field: ${idlPath}`);
    }

    return idl.address;
}

export async function loadSolanaBytecode(args: { bytecodePath: string }) {
    return fs.readFile(args.bytecodePath);
}

const numberArray64 = z
    .array(z.number({ error: 'Keypair must be a number array' }))
    .length(64, { error: 'Keypair must be 64 numbers long' });

const base58PublicKey = z.string().refine(
    (val) => {
        try {
            return !!new PublicKey(val);
        } catch {
            return false;
        }
    },
    { message: 'Invalid base58 public key' },
);

const allDeploymentKeys = ['buffer', 'program', 'escrow'] as const;
type DeploymentKeyName = (typeof allDeploymentKeys)[number];
type DeploymentKeyKeyName<K extends DeploymentKeyName> = `${K}Kp`;
type DeploymentKeys = {
    [K in DeploymentKeyName as DeploymentKeyKeyName<K>]: Keypair;
};

export type DeploymentKey = {
    publicKey: PublicKey;
    secretKey?: Uint8Array;
};

type DeploymentKeyMap = {
    [K in DeploymentKeyName as DeploymentKeyKeyName<K>]: DeploymentKey;
};

export const getDefaultKeysPathFromResolvedPackagePath = (resolvedPackagePath: string) =>
    path.join(resolvedPackagePath, 'default-solana-keys');

export const getKeysPathFromResolvedPackagePath = (resolvedPackagePath: string) =>
    path.join(resolvedPackagePath, 'solana-keys');

const resolveDeploymentKey = (args: {
    key: DeploymentKeyName;
    keypairArray: number[] | undefined;
    publicKeyStr: string | undefined;
    filepath: string;
}): DeploymentKey & { keypair?: Keypair } => {
    const { key, keypairArray, publicKeyStr, filepath } = args;

    if (!keypairArray && !publicKeyStr) {
        throw new Error(
            `Missing both ${key}Keypair and ${key}PublicKey in ${filepath}. At least one is required.`,
        );
    }

    if (keypairArray) {
        const kp = Keypair.fromSecretKey(new Uint8Array(keypairArray));

        if (publicKeyStr) {
            const explicitPubkey = new PublicKey(publicKeyStr);
            if (!kp.publicKey.equals(explicitPubkey)) {
                throw new Error(
                    `Public key mismatch for ${key}: derived ${kp.publicKey.toBase58()} != explicit ${explicitPubkey.toBase58()}`,
                );
            }
        }

        return { publicKey: kp.publicKey, secretKey: kp.secretKey, keypair: kp };
    }

    return { publicKey: new PublicKey(publicKeyStr!) };
};

/**
 * Get deployment keypairs from the keypair file.
 * - If `keysNeeded` is omitted, returns all three keypairs: `bufferKp`, `programKp`, `escrowKp`.
 * - If `keysNeeded` is provided, returns only the requested subset.
 * @param args.contractName - The contract name.
 * @param args.resolvedPackagePath - Path to the package with the keys
 * @param args.allowDefaultKeys - If true, will fallback to default-solana-keys. If false, will throw. DO NOT USE FOR MAINNET OR TESTNET
 * @param args.keysNeeded - Optional tuple of key names to fetch and include in the return value.
 * @param args.allowPublicKeyOnly - If true, accepts public-key-only JSON entries (base58 string in `{name}PublicKey` field). Returns `DeploymentKey` instead of `Keypair`.
 */
export const getKeysForDeployment = async <
    K extends readonly DeploymentKeyName[] = typeof allDeploymentKeys,
    P extends boolean = false,
>(args: {
    contractName: string;
    resolvedPackagePath: string;
    allowDefaultKeys: boolean;
    keysNeeded?: K;
    allowPublicKeyOnly?: P;
}): Promise<
    Pick<P extends true ? DeploymentKeyMap : DeploymentKeys, DeploymentKeyKeyName<K[number]>>
> => {
    try {
        let filepath = path.join(
            getKeysPathFromResolvedPackagePath(args.resolvedPackagePath),
            `${args.contractName}.json`,
        );

        if (!fsSync.existsSync(filepath)) {
            if (args.allowDefaultKeys) {
                filepath = path.join(
                    getDefaultKeysPathFromResolvedPackagePath(args.resolvedPackagePath),
                    `${args.contractName}.json`,
                );
            } else {
                throw new Error(
                    `No keys at ${filepath}, and will not deploy with default keys. Generate the keys for your contract`,
                );
            }
        }

        const keypairData = JSON.parse(await fs.readFile(filepath, 'utf8'));
        const keysNeeded = args.keysNeeded ?? allDeploymentKeys;
        const allowPublicKeyOnly = args.allowPublicKeyOnly ?? false;

        const toKeypairFieldName = (key: K[number]) => `${key}Keypair`;
        const toPublicKeyFieldName = (key: K[number]) => `${key}PublicKey`;

        // Unified schema: each key can have {name}Keypair and/or {name}PublicKey
        const dynamicShape = Object.fromEntries(
            keysNeeded.flatMap((key) => [
                [toKeypairFieldName(key), numberArray64.optional()],
                [toPublicKeyFieldName(key), base58PublicKey.optional()],
            ]),
        );

        const parsedData = z.object(dynamicShape).parse(keypairData) as Record<
            string,
            number[] | string | undefined
        >;

        const result = Object.fromEntries(
            keysNeeded.map((key) => {
                const keypairArray = parsedData[toKeypairFieldName(key)] as number[] | undefined;
                const publicKeyStr = parsedData[toPublicKeyFieldName(key)] as string | undefined;

                const deploymentKey = resolveDeploymentKey({
                    key,
                    keypairArray,
                    publicKeyStr,
                    filepath,
                });

                if (!allowPublicKeyOnly && !deploymentKey.secretKey) {
                    throw new Error(
                        `Missing ${toKeypairFieldName(key)} in ${filepath}. Set allowPublicKeyOnly to use public-key-only entries.`,
                    );
                }

                if (allowPublicKeyOnly) {
                    return [`${key}Kp`, deploymentKey];
                }

                return [`${key}Kp`, deploymentKey.keypair!];
            }),
        );

        const programKp = result.programKp;
        if (!allowPublicKeyOnly && programKp instanceof Keypair) {
            console.log(`✅ Using program keypair from: ${filepath}`);
            console.log(`📋 Program ID: ${programKp.publicKey.toBase58()}`);
        }

        return result as Pick<
            P extends true ? DeploymentKeyMap : DeploymentKeys,
            DeploymentKeyKeyName<K[number]>
        >;
    } catch (error) {
        throw new Error(
            `Failed to load program keypair from ${args.resolvedPackagePath}: ${error instanceof Error ? error.message : error}`,
        );
    }
};
