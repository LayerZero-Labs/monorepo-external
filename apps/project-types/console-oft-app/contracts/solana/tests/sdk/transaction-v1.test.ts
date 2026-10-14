import { generateSigner, type Instruction, publicKey } from '@metaplex-foundation/umi';
import { struct, u64 } from '@metaplex-foundation/umi/serializers';
import {
    address,
    blockhash,
    getCompiledTransactionMessageDecoder,
    getPublicKeyFromAddress,
    getTransactionDecoder,
    verifySignature,
} from '@solana/kit';
import { Connection } from '@solana/web3.js';
import { createHash } from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EDDSA, ExecutorProgram } from '@layerzerolabs/lz-v2-protocol-solana';
import { resolvePlanV3 } from '@layerzerolabs/lz-v2-protocol-solana/v3';
import { expectErrorMessage } from '@layerzerolabs/test-utils-solana/assertions';

import {
    decodeEvents,
    type LandedTransaction,
    sendV1,
    simulateV1,
    TransactionV1Error,
} from '../helpers/transaction-v1';

const key = (n: number) => publicKey(new Uint8Array(32).fill(n));
const LATEST_BLOCKHASH = { blockhash: blockhash(key(9)), lastValidBlockHeight: 100 };
const ANCHOR_ERROR_LOG =
    'Program log: AnchorError occurred. Error Code: Paused. Error Number: 6000.';

type RpcHandler = (method: string, params: unknown[]) => { result?: unknown; error?: unknown };

/** Serve JSON-RPC from `handler`; getLatestBlockhash is answered for every test. */
function mockRpc(handler: RpcHandler) {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: { body?: unknown }) => {
            const { id, method, params } = JSON.parse(String(init.body));
            const reply =
                method === 'getLatestBlockhash'
                    ? { result: { context: { slot: 1 }, value: LATEST_BLOCKHASH } }
                    : handler(method, params);
            if (!reply.result && !reply.error) throw new Error(`Unexpected RPC method ${method}`);
            return new Response(JSON.stringify({ jsonrpc: '2.0', id, ...reply }));
        }),
    );
}

const connection = () => new Connection('http://localhost:8899');

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('sendV1', () => {
    it('submits one signed V1 message above the legacy/V0 size limit, with no address lookup tables', async () => {
        const payer = generateSigner({ eddsa: EDDSA });
        const executor = new ExecutorProgram.Executor(key(4));
        // A 41-account receive plan: bigger than any legacy/V0 message can carry without ALTs.
        const plan = resolvePlanV3(
            {
                contextVersion: 1,
                instructions: [
                    {
                        __kind: 'LzReceive',
                        accounts: [
                            { pubkey: { __kind: 'Payer' }, isWritable: true },
                            { pubkey: { __kind: 'Signer', fields: [0] }, isWritable: true },
                            { pubkey: { __kind: 'Context' }, isWritable: false },
                            ...Array.from({ length: 38 }, (_, i) => ({
                                pubkey: {
                                    __kind: 'Address' as const,
                                    fields: [key(i + 20)] as [ReturnType<typeof key>],
                                },
                                isWritable: false,
                            })),
                        ],
                    },
                ],
            },
            'receive',
            key(3),
            executor.programId,
            payer.publicKey,
            new Uint8Array(100),
        );
        const submitted: Buffer[] = [];
        mockRpc((method, params) => {
            if (method !== 'sendTransaction') return {};
            submitted.push(Buffer.from(params[0] as string, 'base64'));
            expect(params[1]).toMatchObject({ encoding: 'base64', skipPreflight: false });
            return { result: '1'.repeat(64) };
        });
        vi.spyOn(Connection.prototype, 'confirmTransaction').mockResolvedValue({
            context: { slot: 1 },
            value: { err: null },
        });

        await expect(
            sendV1(
                connection(),
                payer,
                [
                    executor.preExecute(payer, 1, 0n),
                    ...plan.instructions,
                    executor.postExecute(payer, 1),
                ],
                { signers: plan.signers },
            ),
        ).resolves.toBe('1'.repeat(64));

        const [wire] = submitted;
        expect(wire[0]).toBe(0x81);
        expect(wire.length).toBeGreaterThan(1232);
        expect(wire.length).toBeLessThanOrEqual(4096);
        const decoded = getTransactionDecoder().decode(wire);
        const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
        if (message.version !== 1) throw new Error('Expected V1');
        expect(message.numInstructions).toBe(3);
        expect(message).not.toHaveProperty('addressTableLookups');
        for (const [signer, signature] of Object.entries(decoded.signatures)) {
            expect(
                await verifySignature(
                    await getPublicKeyFromAddress(address(signer)),
                    signature!,
                    decoded.messageBytes,
                ),
            ).toBe(true);
        }
    });

    it('throws the preflight program logs, so Anchor error assertions can match them', async () => {
        const payer = generateSigner({ eddsa: EDDSA });
        mockRpc((method) =>
            method === 'sendTransaction'
                ? {
                      error: {
                          code: -32002,
                          message: 'Transaction simulation failed',
                          data: { err: 'AccountNotFound', logs: [ANCHOR_ERROR_LOG] },
                      },
                  }
                : {},
        );
        const ix: Instruction = { programId: key(3), keys: [], data: new Uint8Array() };

        await expect(sendV1(connection(), payer, [ix])).rejects.toMatchObject({
            name: 'TransactionV1Error',
            logs: [ANCHOR_ERROR_LOG],
        });
        await expectErrorMessage(
            () => sendV1(connection(), payer, [ix]),
            'Error Code: Paused. Error Number: 6000',
        );
    });

    it('fetches the logs of a transaction that fails after preflight', async () => {
        const payer = generateSigner({ eddsa: EDDSA });
        let wire = '';
        mockRpc((method, params) => {
            if (method === 'sendTransaction') {
                wire = params[0] as string;
                return { result: '1'.repeat(64) };
            }
            if (method === 'getTransaction') {
                expect(params[1]).toMatchObject({
                    encoding: 'base64',
                    maxSupportedTransactionVersion: 1,
                });
                return {
                    result: {
                        slot: 2,
                        blockTime: null,
                        version: 1,
                        transaction: [wire, 'base64'],
                        meta: {
                            err: 'AccountNotFound',
                            logMessages: [ANCHOR_ERROR_LOG],
                            innerInstructions: [],
                        },
                    },
                };
            }
            return {};
        });
        vi.spyOn(Connection.prototype, 'confirmTransaction').mockResolvedValue({
            context: { slot: 2 },
            value: { err: 'AccountNotFound' },
        });
        const ix: Instruction = { programId: key(3), keys: [], data: new Uint8Array() };

        const error = await sendV1(connection(), payer, [ix]).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(TransactionV1Error);
        expect((error as TransactionV1Error).logs).toEqual([ANCHOR_ERROR_LOG]);
    });

    it('refuses to submit without a local keypair for every required signer', async () => {
        const payer = generateSigner({ eddsa: EDDSA });
        const ix: Instruction = {
            programId: key(3),
            keys: [{ pubkey: key(5), isSigner: true, isWritable: false }],
            data: new Uint8Array(),
        };
        mockRpc(() => ({}));

        await expect(sendV1(connection(), payer, [ix])).rejects.toThrow(
            `needs a local keypair for signer ${key(5)}`,
        );
    });
});

describe('simulateV1', () => {
    const programId = key(3);
    const ix: Instruction = { programId, keys: [], data: new Uint8Array() };
    const returnData = (from: typeof programId) => {
        const data = Buffer.alloc(8);
        data.writeBigUInt64LE(42n);
        return { data: [data.toString('base64'), 'base64'], programId: from };
    };

    it('decodes return data from an unsigned V1 simulation', async () => {
        let simulated: unknown[] = [];
        mockRpc((method, params) => {
            if (method !== 'simulateTransaction') return {};
            simulated = params;
            return {
                result: {
                    context: { slot: 1 },
                    value: { err: null, logs: [], returnData: returnData(programId) },
                },
            };
        });

        await expect(simulateV1(connection(), key(1), [ix], programId, u64())).resolves.toBe(42n);

        expect(simulated[1]).toMatchObject({ encoding: 'base64', sigVerify: false });
        const decoded = getTransactionDecoder().decode(
            Buffer.from(simulated[0] as string, 'base64'),
        );
        expect(Object.values(decoded.signatures)).toEqual([null]);
        const message = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
        if (message.version !== 1) throw new Error('Expected V1');
        expect(message).not.toHaveProperty('addressTableLookups');
    });

    it('rejects return data written by a different program', async () => {
        mockRpc((method) =>
            method === 'simulateTransaction'
                ? {
                      result: {
                          context: { slot: 1 },
                          value: { err: null, logs: [], returnData: returnData(key(4)) },
                      },
                  }
                : {},
        );

        await expect(simulateV1(connection(), key(1), [ix], programId, u64())).rejects.toThrow(
            `returned no data from ${programId}`,
        );
    });
});

describe('decodeEvents', () => {
    it('selects emit_cpi events by emitting program and event discriminator', () => {
        const event = struct<{ amount: bigint }>([['amount', u64()]], { description: 'Credited' });
        const emitted = (name: string, amount: bigint) => {
            const payload = Buffer.alloc(8);
            payload.writeBigUInt64LE(amount);
            return Buffer.concat([
                Buffer.from('e445a52e51cb9a1d', 'hex'),
                createHash('sha256').update(`event:${name}`).digest().subarray(0, 8),
                payload,
            ]);
        };
        const transaction: LandedTransaction = {
            version: 1,
            staticAccounts: [],
            logs: [],
            innerInstructions: [
                { programId: String(key(3)), data: emitted('Credited', 7n) },
                { programId: String(key(3)), data: emitted('Debited', 8n) },
                { programId: String(key(4)), data: emitted('Credited', 9n) },
            ],
        };

        expect(decodeEvents(transaction, key(3), event)).toEqual([{ amount: 7n }]);
    });
});
