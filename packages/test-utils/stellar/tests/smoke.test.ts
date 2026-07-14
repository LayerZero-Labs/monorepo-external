import { describe, expect, it } from 'vitest';

import { createStellarTestEnv } from '../src/env.js';
import {
    accountExists,
    buildDockerRunArgs,
    DEFAULT_STELLAR_LOCALNET_IMAGE,
    FUNDING_RETRY_INTERVAL_MS,
    getNamedContainerRemovalPolicy,
    pauseBeforeFundingRetry,
    startStellarLocalnet,
    STELLAR_LOCALNET_OWNER_LABEL,
} from '../src/localnet.js';

describe('createStellarTestEnv', () => {
    it('produces distinct RPC_URL for different host ports', () => {
        const a = createStellarTestEnv({ containerName: 'stellar-a', hostPort: 8096 });
        const b = createStellarTestEnv({ containerName: 'stellar-b', hostPort: 8106 });

        expect(a.RPC_URL).toBe('http://localhost:8096/soroban/rpc');
        expect(b.RPC_URL).toBe('http://localhost:8106/soroban/rpc');
        expect(a.RPC_URL).not.toBe(b.RPC_URL);
        expect(a.CONTAINER_NAME).toBe('stellar-a');
        expect(b.CONTAINER_NAME).toBe('stellar-b');
        expect(a.HOST_PORT).toBe(8096);
        expect(b.HOST_PORT).toBe(8106);
    });

    it('shares deterministic keys and EIDs across envs', () => {
        const a = createStellarTestEnv({ containerName: 'a', hostPort: 1 });
        const b = createStellarTestEnv({ containerName: 'b', hostPort: 2 });

        expect(a.DEFAULT_DEPLOYER.publicKey()).toBe(b.DEFAULT_DEPLOYER.publicKey());
        expect(a.EID_A).toBe(30401);
        expect(a.EID_B).toBe(30402);
        expect(a.EID).toBe(a.EID_A);
    });
});

describe('startStellarLocalnet arg validation', () => {
    it('rejects shell-metacharacter container names before invoking docker', async () => {
        const env = createStellarTestEnv({
            containerName: 'evil; rm -rf /',
            hostPort: 8096,
        });
        await expect(startStellarLocalnet({ env })).rejects.toThrow(
            /Invalid docker container name/,
        );
    });

    it('rejects out-of-range host ports before invoking docker', async () => {
        const env = createStellarTestEnv({ containerName: 'stellar-ok', hostPort: 0 });
        await expect(startStellarLocalnet({ env })).rejects.toThrow(/Invalid docker host port/);
    });
});

describe('Docker localnet arguments', () => {
    it('binds the RPC port to loopback and labels the owned container', () => {
        const env = createStellarTestEnv({ containerName: 'stellar-localnet', hostPort: 8096 });

        expect(buildDockerRunArgs(env)).toEqual([
            'run',
            '-d',
            '--name',
            'stellar-localnet',
            '--label',
            STELLAR_LOCALNET_OWNER_LABEL,
            '-p',
            '127.0.0.1:8096:8000',
            DEFAULT_STELLAR_LOCALNET_IMAGE,
        ]);
    });

    it('uses a validated per-environment Docker image override', () => {
        const env = createStellarTestEnv({
            containerName: 'stellar-localnet',
            hostPort: 8096,
            dockerImage: 'registry.example.com/stellar:local',
        });

        expect(buildDockerRunArgs(env).at(-1)).toBe('registry.example.com/stellar:local');
    });

    it('rejects invalid Docker image overrides', () => {
        const env = createStellarTestEnv({
            containerName: 'stellar-localnet',
            hostPort: 8096,
            dockerImage: 'image; rm -rf /',
        });

        expect(() => buildDockerRunArgs(env)).toThrow(/Invalid docker image/);
    });
});

describe('named container ownership policy', () => {
    it('removes only containers carrying the localnet ownership label', () => {
        expect(getNamedContainerRemovalPolicy('container-id', '1')).toBe('remove');
        expect(getNamedContainerRemovalPolicy('container-id', undefined)).toBe('reject');
        expect(getNamedContainerRemovalPolicy('container-id', 'other')).toBe('reject');
    });

    it('does not require removal when the name is unused', () => {
        expect(getNamedContainerRemovalPolicy(undefined, undefined)).toBe('absent');
    });
});

describe('funding idempotency helper', () => {
    it('recognizes an account that appeared after an ambiguous poll', async () => {
        await expect(
            accountExists(async () => ({ id: 'destination' }), 'destination'),
        ).resolves.toBe(true);
    });

    it('does not hide a destination account lookup failure', async () => {
        await expect(
            accountExists(async () => Promise.reject(new Error('not found')), 'destination'),
        ).resolves.toBe(false);
    });
});

describe('funding retry backoff', () => {
    it('sleeps between non-final funding rebuild attempts', async () => {
        const slept: number[] = [];
        await pauseBeforeFundingRetry(1, 3, async (ms) => {
            slept.push(ms);
        });
        expect(slept).toEqual([FUNDING_RETRY_INTERVAL_MS]);
    });

    it('does not sleep after the final funding attempt', async () => {
        const slept: number[] = [];
        await pauseBeforeFundingRetry(3, 3, async (ms) => {
            slept.push(ms);
        });
        expect(slept).toEqual([]);
    });
});
