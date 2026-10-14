import { publicKey, type RpcInterface } from '@metaplex-foundation/umi';
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import type { SimulatedTransactionResponse } from '@solana/web3.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    decodePlanOutput,
    DEFAULT_PLAN_SCRATCH_BYTES,
    estimatePlanBytes,
    getPlannerAccounts,
    planScratchBytes,
    resolvePlanV3,
    simulatePlanV3,
} from '../src/plan-v3';
import { getLzReceiveTypesV3ResultSerializer, type LzReceiveTypesV3Result } from '../src/types-v3';
import { instructionDiscriminator } from '../src/utility';

const key = (n: number) => publicKey(new Uint8Array(32).fill(n));
const program = key(1),
    payer = key(2),
    receiver = key(3),
    executor = key(4);
const serializer = getLzReceiveTypesV3ResultSerializer();
afterEach(() => vi.unstubAllGlobals());

/** Mock only HTTP. Kit's compiler, encoder, RPC request and response codecs all run. */
function mockRpc(responses: SimulatedTransactionResponse[]) {
    const simulations: { wire: Buffer; config: Record<string, unknown> }[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: { body?: unknown }) => {
            const { id, method, params } = JSON.parse(String(init.body));
            let value;
            if (method === 'getLatestBlockhash') {
                value = { blockhash: key(9), lastValidBlockHeight: 100 };
            } else if (method === 'getMinimumBalanceForRentExemption') {
                return new Response(
                    JSON.stringify({ jsonrpc: '2.0', id, result: (128 + params[0]) * 6960 }),
                );
            } else if (method === 'simulateTransaction') {
                simulations.push({ wire: Buffer.from(params[0], 'base64'), config: params[1] });
                value = responses.shift();
                if (!value) throw new Error('Unexpected simulation');
            } else {
                throw new Error(`Unexpected RPC method: ${method}`);
            }
            return new Response(
                JSON.stringify({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value } }),
            );
        }),
    );
    return simulations;
}

function decodeV1(wire: Buffer) {
    expect(wire[0]).toBe(0x81); // V1 message-first envelope, not a V0 signatures-first transaction.
    const message = getCompiledTransactionMessageDecoder().decode(
        getTransactionDecoder().decode(wire).messageBytes,
    );
    if (message.version !== 1) throw new Error('Expected Transaction V1');
    expect(message.configValues).toEqual([
        { kind: 'u32', value: 1_400_000 },
        { kind: 'u32', value: 64 * 1024 * 1024 },
        { kind: 'u32', value: 256 * 1024 },
    ]);
    expect(message.staticAccounts).not.toContain('ComputeBudget111111111111111111111111111111');
    return message;
}
const plan: LzReceiveTypesV3Result = {
    contextVersion: 1,
    instructions: [
        {
            __kind: 'LzReceive',
            accounts: Array.from({ length: 41 }, () => ({
                pubkey: { __kind: 'Address', fields: [receiver] },
                isWritable: false,
            })),
        },
    ],
};

function response(value = plan): SimulatedTransactionResponse {
    const payload = serializer.serialize(value);
    const data = Buffer.from(payload);
    const size = Buffer.alloc(4);
    size.writeUInt32LE(data.length);
    return {
        err: null,
        logs: [],
        returnData: { programId: program, data: [size.toString('base64'), 'base64'] },
        accounts: [
            {
                owner: program,
                executable: false,
                lamports: 1,
                rentEpoch: 0,
                data: [data.toString('base64'), 'base64'],
            },
        ],
    };
}

/** The plan did not fit: the scratch stays zeroed and only the size comes back. */
function undersized(
    requiredBytes: number,
    space = DEFAULT_PLAN_SCRATCH_BYTES,
): SimulatedTransactionResponse {
    const r = response();
    const size = Buffer.alloc(4);
    size.writeUInt32LE(requiredBytes);
    r.returnData!.data[0] = size.toString('base64');
    r.accounts![0]!.data[0] = Buffer.alloc(space).toString('base64');
    return r;
}

describe('V3 account-backed plans', () => {
    it('round-trips output beyond return-data capacity without ALTs', () => {
        expect(serializer.serialize(plan).length).toBeGreaterThan(1024);
        expect(decodePlanOutput(response(), program, serializer)).toEqual({ plan });
    });
    it('estimates a scratch size that actually holds the plan', () => {
        const estimate = estimatePlanBytes({ instructions: 1, accounts: 41 });
        expect(serializer.serialize(plan).length).toBeLessThanOrEqual(estimate);
        expect(planScratchBytes(estimate)).toBeGreaterThanOrEqual(estimate);
        expect(estimate).toBeLessThanOrEqual(DEFAULT_PLAN_SCRATCH_BYTES);
    });
    it.each([
        [
            'simulation error',
            (r: SimulatedTransactionResponse) => {
                r.err = { InstructionError: [0, 'InvalidArgument'] };
            },
        ],
        [
            'foreign size result',
            (r: SimulatedTransactionResponse) => {
                r.returnData!.programId = payer;
            },
        ],
        [
            'missing account',
            (r: SimulatedTransactionResponse) => {
                r.accounts = [null];
            },
        ],
        [
            'foreign account',
            (r: SimulatedTransactionResponse) => {
                r.accounts![0]!.owner = payer;
            },
        ],
        [
            'executable account',
            (r: SimulatedTransactionResponse) => {
                r.accounts![0]!.executable = true;
            },
        ],
        [
            'a plan shorter than the size it reported',
            (r: SimulatedTransactionResponse) => {
                const data = Buffer.from(r.accounts![0]!.data[0], 'base64');
                data.writeUInt32LE(0, 1); // empty instruction vector, trailing bytes unconsumed
                r.accounts![0]!.data[0] = data.toString('base64');
            },
        ],
        [
            'zero size',
            (r: SimulatedTransactionResponse) => {
                const data = Buffer.from(r.returnData!.data[0], 'base64');
                data.fill(0);
                r.returnData!.data[0] = data.toString('base64');
            },
        ],
    ])('rejects %s', (_, mutate) => {
        const r = response();
        mutate(r);
        expect(() => decodePlanOutput(r, program, serializer)).toThrow();
    });
    it('reports the required size without decoding an account that never received the plan', () => {
        const r = undersized(15000);
        expect(decodePlanOutput(r, program, serializer)).toEqual({
            requiredBytes: 15000,
            availableBytes: Buffer.from(r.accounts![0]!.data[0], 'base64').length,
        });
        expect(() => decodePlanOutput(r, program, serializer, 12000)).toThrow();
    });
    it('does not turn literal pubkeys into signers; shares indexed ephemeral signers across instructions', () => {
        const shared = {
            pubkey: { __kind: 'Signer' as const, fields: [7] as [number] },
            isWritable: true,
        };
        const p: LzReceiveTypesV3Result = {
            contextVersion: 1,
            instructions: [
                {
                    __kind: 'Standard',
                    programId: receiver,
                    data: new Uint8Array([1]),
                    accounts: [shared],
                },
                {
                    __kind: 'Standard',
                    programId: receiver,
                    data: new Uint8Array([1]),
                    accounts: [shared],
                },
                {
                    __kind: 'LzReceive',
                    accounts: [
                        shared,
                        { pubkey: { __kind: 'Payer' }, isWritable: true },
                        { pubkey: { __kind: 'Address', fields: [payer] }, isWritable: false },
                    ],
                },
            ],
        };
        const resolved = resolvePlanV3(p, 'receive', program, executor, payer, new Uint8Array());
        expect(resolved.signers).toHaveLength(1);
        expect(resolved.instructions[0].keys[0]).toEqual(resolved.instructions[2].keys[0]);
        expect(resolved.instructions[2].keys[1].isSigner).toBe(true);
        expect(resolved.instructions[2].keys[2].isSigner).toBe(false);
    });
    it('rejects absent, duplicate and disguised primary delivery', () => {
        for (const instructions of [
            [],
            [...plan.instructions, ...plan.instructions],
            [
                ...plan.instructions,
                {
                    __kind: 'Standard' as const,
                    programId: program,
                    accounts: [],
                    data: instructionDiscriminator('lz_receive'),
                },
            ],
        ]) {
            expect(() =>
                resolvePlanV3(
                    { ...plan, instructions },
                    'receive',
                    program,
                    executor,
                    payer,
                    new Uint8Array(),
                ),
            ).toThrow();
        }
    });
    it('creates its own scratch and re-creates it larger when the plan did not fit', async () => {
        const simulations = mockRpc([undersized(15000), response()]);
        expect(
            await simulatePlanV3(
                { getEndpoint: () => 'http://localhost:8899' } as RpcInterface,
                payer,
                program,
                'receive',
                new Uint8Array(),
                [],
                serializer,
                'confirmed',
            ),
        ).toEqual(plan);
        expect(simulations).toHaveLength(2);

        const spaces = simulations.map((simulation) => {
            const message = decodeV1(simulation.wire);
            expect(message.numInstructions).toBe(2); // create + planner; budgets are V1 config.
            const [create, planner] = message.instructionPayloads;
            expect(message.staticAccounts[message.instructionHeaders[0].programAccountIndex]).toBe(
                '11111111111111111111111111111111',
            );
            const scratch = message.staticAccounts[create.instructionAccountIndices[1]];
            // The scratch is the only post-state read, and the planner takes it as a signer.
            expect(simulation.config.accounts).toEqual({
                encoding: 'base64',
                addresses: [scratch],
            });
            expect(message.staticAccounts[planner.instructionAccountIndices[1]]).toBe(scratch);
            expect(message.header.numSignerAccounts).toBe(2);
            // create_account: u32 tag, u64 lamports, u64 space, 32-byte owner.
            return Number(Buffer.from(create.instructionData).readBigUInt64LE(12));
        });
        expect(spaces).toEqual([DEFAULT_PLAN_SCRATCH_BYTES, planScratchBytes(15000)]);
    });

    it('never creates a scratch larger than a maxPlanBytes off the 512-byte granularity', async () => {
        const small: LzReceiveTypesV3Result = {
            contextVersion: 1,
            instructions: [
                {
                    __kind: 'LzReceive',
                    accounts: [
                        { pubkey: { __kind: 'Address', fields: [receiver] }, isWritable: false },
                    ],
                },
            ],
        };
        const simulations = mockRpc([response(small)]);
        expect(
            await simulatePlanV3(
                { getEndpoint: () => 'http://localhost:8899' } as RpcInterface,
                payer,
                program,
                'receive',
                new Uint8Array(),
                [],
                serializer,
                'confirmed',
                { maxPlanBytes: 1000 },
            ),
        ).toEqual(small);
        const [create] = decodeV1(simulations[0].wire).instructionPayloads;
        // Rounding 1000 up to the granularity would ask for 1024.
        expect(Number(Buffer.from(create.instructionData).readBigUInt64LE(12))).toBe(1000);
    });

    it('restores the trailing zero bytes the runtime trims from the plan size', () => {
        const r = response();
        const size = Buffer.from(r.returnData!.data[0], 'base64');
        let end = size.length;
        while (end > 0 && size[end - 1] === 0) end--;
        r.returnData!.data[0] = size.subarray(0, end).toString('base64');
        expect(end).toBeLessThan(4);
        expect(decodePlanOutput(r, program, serializer)).toEqual({ plan });
    });

    it('restores the trailing zero bytes the runtime trims from the bootstrap', async () => {
        // The System Program's key is all zero bytes, so a bootstrap ending in it is trimmed hard.
        const system = publicKey(new Uint8Array(32));
        const full = Buffer.concat([
            Buffer.from([3, 2, 0, 0, 0]),
            Buffer.from(new Uint8Array(32).fill(7)),
            Buffer.from(new Uint8Array(32)),
        ]);
        const r = response();
        r.returnData!.data[0] = full.subarray(0, 5 + 32).toString('base64');
        mockRpc([r]);
        const { accounts } = await getPlannerAccounts(
            { getEndpoint: () => 'http://localhost:8899' } as RpcInterface,
            payer,
            receiver,
            program,
            'receive',
            new Uint8Array(),
            'confirmed',
        );
        expect(accounts).toEqual([key(7), system]);
    });

    it('restores a bootstrap trimmed into its header', async () => {
        const system = publicKey(new Uint8Array(32));
        // [3] is a V3 bootstrap with count 0; [3, 1] is count 1 whose one input is all zero bytes.
        for (const [returned, expected] of [
            [[3], []],
            [[3, 1], [system]],
        ] as const) {
            const r = response();
            r.returnData!.data[0] = Buffer.from(returned).toString('base64');
            mockRpc([r]);
            const { accounts } = await getPlannerAccounts(
                { getEndpoint: () => 'http://localhost:8899' } as RpcInterface,
                payer,
                receiver,
                program,
                'receive',
                new Uint8Array(),
                'confirmed',
            );
            expect(accounts).toEqual(expected);
        }
    });

    it('rejects a bootstrap count that cannot fit in return data before padding to it', async () => {
        const r = response();
        r.returnData!.data[0] = Buffer.from([3, 0, 0, 0, 16]).toString('base64');
        mockRpc([r]);
        await expect(
            getPlannerAccounts(
                { getEndpoint: () => 'http://localhost:8899' } as RpcInterface,
                payer,
                receiver,
                program,
                'receive',
                new Uint8Array(),
                'confirmed',
            ),
        ).rejects.toThrow('V3 planner bootstrap');
    });

    it('rejects a V2 bootstrap instead of silently falling back', async () => {
        const r = response();
        r.returnData!.data[0] = Buffer.from([2, 0, 0, 0, 0]).toString('base64');
        const simulations = mockRpc([r]);
        await expect(
            getPlannerAccounts(
                { getEndpoint: () => 'http://localhost:8899' } as RpcInterface,
                payer,
                receiver,
                program,
                'receive',
                new Uint8Array(),
                'confirmed',
            ),
        ).rejects.toThrow('V3 planner bootstrap');
        expect(simulations).toHaveLength(1);
        expect(decodeV1(simulations[0].wire).numInstructions).toBe(1);
    });
});
