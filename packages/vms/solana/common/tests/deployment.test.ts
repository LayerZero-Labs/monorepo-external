import { Keypair } from '@solana/web3.js';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DeploymentKey } from '../src/deployment';
import { getKeysForDeployment } from '../src/deployment';

describe('getKeysForDeployment', () => {
    let tmpDir: string;
    let keysDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'solana-keys-test-'));
        keysDir = path.join(tmpDir, 'solana-keys');
        await fs.mkdir(keysDir, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    const writeKeyFile = async (contractName: string, data: Record<string, unknown>) => {
        await fs.writeFile(path.join(keysDir, `${contractName}.json`), JSON.stringify(data));
    };

    const generateKeypairData = () => {
        const kp = Keypair.generate();
        return { keypair: kp, data: Array.from(kp.secretKey) };
    };

    describe('existing behavior (allowPublicKeyOnly: false/omitted)', () => {
        it('returns Keypair when keypair-only JSON is provided', async () => {
            const { keypair, data } = generateKeypairData();
            await writeKeyFile('TestContract', { escrowKeypair: data });

            const result = await getKeysForDeployment({
                contractName: 'TestContract',
                resolvedPackagePath: tmpDir,
                allowDefaultKeys: false,
                keysNeeded: ['escrow'] as const,
            });

            expect(result.escrowKp).toBeInstanceOf(Keypair);
            expect(result.escrowKp.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
        });

        it('throws when only public key is provided', async () => {
            const kp = Keypair.generate();
            await writeKeyFile('TestContract', {
                escrowPublicKey: kp.publicKey.toBase58(),
            });

            await expect(
                getKeysForDeployment({
                    contractName: 'TestContract',
                    resolvedPackagePath: tmpDir,
                    allowDefaultKeys: false,
                    keysNeeded: ['escrow'] as const,
                }),
            ).rejects.toThrow();
        });
    });

    describe('allowPublicKeyOnly: true', () => {
        it('returns DeploymentKey with secretKey when keypair-only JSON is provided', async () => {
            const { keypair, data } = generateKeypairData();
            await writeKeyFile('TestContract', { escrowKeypair: data });

            const result = await getKeysForDeployment({
                contractName: 'TestContract',
                resolvedPackagePath: tmpDir,
                allowDefaultKeys: false,
                keysNeeded: ['escrow'] as const,
                allowPublicKeyOnly: true,
            });

            const escrowKey = result.escrowKp as DeploymentKey;
            expect(escrowKey.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
            expect(escrowKey.secretKey).toBeDefined();
            expect(escrowKey.secretKey).toEqual(keypair.secretKey);
        });

        it('returns DeploymentKey with only publicKey when pubkey-only JSON is provided', async () => {
            const kp = Keypair.generate();
            await writeKeyFile('TestContract', {
                escrowPublicKey: kp.publicKey.toBase58(),
            });

            const result = await getKeysForDeployment({
                contractName: 'TestContract',
                resolvedPackagePath: tmpDir,
                allowDefaultKeys: false,
                keysNeeded: ['escrow'] as const,
                allowPublicKeyOnly: true,
            });

            const escrowKey = result.escrowKp as DeploymentKey;
            expect(escrowKey.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
            expect(escrowKey.secretKey).toBeUndefined();
        });

        it('returns DeploymentKey when both fields are provided and match', async () => {
            const { keypair, data } = generateKeypairData();
            await writeKeyFile('TestContract', {
                escrowKeypair: data,
                escrowPublicKey: keypair.publicKey.toBase58(),
            });

            const result = await getKeysForDeployment({
                contractName: 'TestContract',
                resolvedPackagePath: tmpDir,
                allowDefaultKeys: false,
                keysNeeded: ['escrow'] as const,
                allowPublicKeyOnly: true,
            });

            const escrowKey = result.escrowKp as DeploymentKey;
            expect(escrowKey.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
            expect(escrowKey.secretKey).toBeDefined();
        });

        it('throws when both fields are provided but mismatch', async () => {
            const { data } = generateKeypairData();
            const differentKp = Keypair.generate();
            await writeKeyFile('TestContract', {
                escrowKeypair: data,
                escrowPublicKey: differentKp.publicKey.toBase58(),
            });

            await expect(
                getKeysForDeployment({
                    contractName: 'TestContract',
                    resolvedPackagePath: tmpDir,
                    allowDefaultKeys: false,
                    keysNeeded: ['escrow'] as const,
                    allowPublicKeyOnly: true,
                }),
            ).rejects.toThrow('Public key mismatch');
        });

        it('throws when neither keypair nor public key is provided', async () => {
            await writeKeyFile('TestContract', {});

            await expect(
                getKeysForDeployment({
                    contractName: 'TestContract',
                    resolvedPackagePath: tmpDir,
                    allowDefaultKeys: false,
                    keysNeeded: ['escrow'] as const,
                    allowPublicKeyOnly: true,
                }),
            ).rejects.toThrow('Missing both');
        });

        it('throws on invalid base58 string', async () => {
            await writeKeyFile('TestContract', {
                escrowPublicKey: 'not-a-valid-base58!!!',
            });

            await expect(
                getKeysForDeployment({
                    contractName: 'TestContract',
                    resolvedPackagePath: tmpDir,
                    allowDefaultKeys: false,
                    keysNeeded: ['escrow'] as const,
                    allowPublicKeyOnly: true,
                }),
            ).rejects.toThrow();
        });
    });
});
