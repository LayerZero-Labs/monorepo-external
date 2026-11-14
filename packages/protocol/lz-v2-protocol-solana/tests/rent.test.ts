import type { RpcInterface } from '@metaplex-foundation/umi';
import {
    createNoopSigner,
    generateSigner,
    lamports,
    none,
    publicKey,
    some,
} from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { describe, expect, it } from 'vitest';

import { Endpoint } from '../src/endpoint';
import { getCreatedAccountsRentLamports } from '../src/rent';
import { Uln } from '../src/uln';

const LAMPORTS_PER_BYTE = 6960n;

const fakeRpc = (accountExists: boolean): RpcInterface =>
    ({
        getAccount: async (address: unknown) => ({ exists: accountExists, publicKey: address }),
        accountExists: async () => accountExists,
        getRent: async (bytes: number) => lamports(BigInt(bytes) * LAMPORTS_PER_BYTE),
    }) as unknown as RpcInterface;

const umi = createUmi('http://localhost:8899');
const admin = createNoopSigner(generateSigner(umi).publicKey);
const messageLibProgram = publicKey('7a4WjyR8VZ7yZz5XJAKm39BUGn5iT9CKcv2pmG9tdXVH');
const dvn = generateSigner(umi).publicKey;
const ulnConfig = {
    confirmations: 1n,
    requiredDvnCount: 1,
    optionalDvnCount: 0,
    optionalDvnThreshold: 0,
    requiredDvns: [dvn],
    optionalDvns: [],
};
const executorConfig = { maxMessageSize: 10000, executor: generateSigner(umi).publicKey };

describe('getCreatedAccountsRentLamports', () => {
    it('reports the rent of the MessageLibInfo account that registerLibrary creates', async () => {
        const ix = new Endpoint().registerLibrary(admin, { messageLibProgram });

        await expect(getCreatedAccountsRentLamports(fakeRpc(false), ix)).resolves.toBe(967440n);
    });

    it.each([
        { exists: false, expected: 1176240n },
        { exists: true, expected: 0n },
    ])(
        'reports $expected for setDefaultSendLibrary when the config exists=$exists',
        async ({ exists, expected }) => {
            const rpc = fakeRpc(exists);
            const ix = await new Endpoint().setDefaultSendLibrary(rpc, admin, {
                messageLibProgram,
                remote: 30101,
            });

            await expect(getCreatedAccountsRentLamports(rpc, ix)).resolves.toBe(expected);
        },
    );

    it.each([
        { exists: false, expected: 1461600n },
        { exists: true, expected: 0n },
    ])(
        'reports $expected for setDefaultReceiveLibrary when the config exists=$exists',
        async ({ exists, expected }) => {
            const rpc = fakeRpc(exists);
            const ix = await new Endpoint().setDefaultReceiveLibrary(rpc, admin, {
                messageLibProgram,
                remote: 30101,
            });

            await expect(getCreatedAccountsRentLamports(rpc, ix)).resolves.toBe(expected);
        },
    );

    it.each([
        { exists: false, expected: 16676160n },
        { exists: true, expected: 0n },
    ])(
        'reports $expected for initOrUpdateDefaultConfig when the config exists=$exists',
        async ({ exists, expected }) => {
            const rpc = fakeRpc(exists);
            const ix = await new Uln().initOrUpdateDefaultConfig(rpc, admin, {
                remote: 30101,
                sendUlnConfig: some(ulnConfig),
                receiveUlnConfig: some(ulnConfig),
                executorConfig: some(executorConfig),
            });

            await expect(getCreatedAccountsRentLamports(rpc, ix)).resolves.toBe(expected);
        },
    );

    it('reports 0n for a setDefaultConfig that changes only the executor', async () => {
        const rpc = fakeRpc(true);
        const ix = await new Uln().initOrUpdateDefaultConfig(rpc, admin, {
            remote: 30101,
            sendUlnConfig: none(),
            receiveUlnConfig: none(),
            executorConfig: some(executorConfig),
        });

        await expect(getCreatedAccountsRentLamports(rpc, ix)).resolves.toBe(0n);
    });
});
