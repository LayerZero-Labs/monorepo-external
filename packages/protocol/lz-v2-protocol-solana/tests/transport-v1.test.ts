import { publicKey } from '@metaplex-foundation/umi';
import { struct, u64 } from '@metaplex-foundation/umi/serializers';
import { Connection } from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { simulateTransactionV1 } from '../src/transport-v1';

const key = (n: number) => publicKey(new Uint8Array(32).fill(n));
const program = key(1);
const budgets = {
    computeUnitLimit: 1_400_000,
    loadedAccountsDataSizeLimit: 64 * 1024 * 1024,
    heapSize: 256 * 1024,
};
afterEach(() => vi.unstubAllGlobals());

/** Mock only HTTP: one simulation that returns `returnData` from `program`. */
function mockSimulation(returnData: Buffer) {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: { body?: unknown }) => {
            const { id, method } = JSON.parse(String(init.body));
            const value =
                method === 'getLatestBlockhash'
                    ? { blockhash: key(9), lastValidBlockHeight: 100 }
                    : {
                          err: null,
                          logs: [],
                          returnData: {
                              programId: program,
                              data: [returnData.toString('base64'), 'base64'],
                          },
                      };
            return new Response(
                JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value } }),
            );
        }),
    );
}

describe('simulateTransactionV1', () => {
    it('restores the trailing zero bytes the runtime trims from return data', async () => {
        const fee = struct([
            ['nativeFee', u64()],
            ['lzTokenFee', u64()],
        ]);
        // A MessagingFee with lzTokenFee 0 is recorded as its single leading nonzero byte.
        mockSimulation(Buffer.from([5]));
        const connection = new Connection('http://127.0.0.1:8899');
        const instruction = { programId: program, keys: [], data: new Uint8Array() };
        await expect(
            simulateTransactionV1(connection, key(2), [instruction], program, fee, budgets),
        ).resolves.toEqual({ nativeFee: 5n, lzTokenFee: 0n });
    });
});
