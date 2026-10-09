import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { Transaction } from '@mysten/sui-v2/transactions';
import { toBase64 } from '@mysten/sui-v2/utils';
import { describe, expect, it, vi } from 'vitest';

import type { DevInspectTransactionBlockGrpcClient } from './devInspectTransactionBlock';
import { devInspectTransactionBlock } from './devInspectTransactionBlock';

const SENDER = '0x1';

const buildKindBytes = async (): Promise<string> => {
    const tx = new Transaction();
    tx.moveCall({
        target: '0x2::coin::value',
        typeArguments: ['0x2::sui::SUI'],
        arguments: [tx.pure.u64(1)],
    });
    return toBase64(await tx.build({ onlyTransactionKind: true }));
};

const grpcClientWith = (result: unknown): DevInspectTransactionBlockGrpcClient => ({
    simulateTransaction: vi
        .fn()
        .mockResolvedValue(result) as unknown as SuiGrpcClient['simulateTransaction'],
});

const success = (commandOutputs: unknown[]) => ({
    $kind: 'Transaction',
    Transaction: { status: { success: true, error: null } },
    protoJson: { commandOutputs },
});
const output = (name: string, bytes: number[]) => ({
    value: { name, value: toBase64(new Uint8Array(bytes)) },
});

describe('devInspectTransactionBlock', () => {
    it('maps executed bytes and type names to legacy tuples without function lookups', async () => {
        const grpcClient = grpcClientWith(
            success([{ returnValues: [output('u64', [8, 0, 0, 0, 0, 0, 0, 0])] }]),
        );
        const signal = new AbortController().signal;
        const result = await devInspectTransactionBlock(
            grpcClient,
            [SENDER, await buildKindBytes()],
            signal,
        );
        expect(result).toEqual({
            error: null,
            results: [{ returnValues: [[[8, 0, 0, 0, 0, 0, 0, 0], 'u64']] }],
        });
        expect(grpcClient.simulateTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                checksEnabled: false,
                include: { commandResults: true, protoJson: true },
                signal,
            }),
        );
    });

    it('preserves the executed PTB result type when reservations add surrounding commands', async () => {
        // The first and last commands are inserted by Sui. Matching the submitted command
        // count or guessing an offset loses the type required by configurePtbSimulation.
        const grpcClient = grpcClientWith(
            success([
                { returnValues: [output('0x2::coin::Coin<0x2::sui::SUI>', [1])] },
                {
                    returnValues: [
                        output(`vector<0x${'0'.repeat(61)}123::move_call::MoveCall>`, [0]),
                    ],
                },
                {},
            ]),
        );
        const result = await devInspectTransactionBlock(grpcClient, [
            SENDER,
            await buildKindBytes(),
        ]);
        expect(result.results).toEqual([
            { returnValues: [[[1], '0x2::coin::Coin<0x2::sui::SUI>']] },
            { returnValues: [[[0], 'vector<0x123::move_call::MoveCall>']] },
            { returnValues: [] },
        ]);
        const ptbResults = result
            .results!.flatMap((r) => r.returnValues)
            .filter(([, type]) => type === 'vector<0x123::move_call::MoveCall>');
        expect(ptbResults).toHaveLength(1);
    });

    it('normalizes nested type addresses and comma spacing to legacy rendering', async () => {
        const packageId = `0x${'0'.repeat(61)}123`;
        const grpcClient = grpcClientWith(
            success([
                { returnValues: [output(`${packageId}::m::T<${packageId}::m::U,u64>`, [1])] },
            ]),
        );
        const result = await devInspectTransactionBlock(grpcClient, [
            SENDER,
            await buildKindBytes(),
        ]);
        expect(result.results?.[0].returnValues[0][1]).toBe('0x123::m::T<0x123::m::U, u64>');
    });

    it('surfaces an execution failure before the PTB decoder tries to find results', async () => {
        const grpcClient = grpcClientWith({
            $kind: 'FailedTransaction',
            FailedTransaction: {
                status: { success: false, error: { message: 'MoveAbort in coin::value' } },
            },
            protoJson: {},
        });
        expect(
            await devInspectTransactionBlock(grpcClient, [SENDER, await buildKindBytes()]),
        ).toEqual({ error: 'MoveAbort in coin::value', results: [] });
    });

    it('retains all bytes when an optional output type name is missing', async () => {
        const grpcClient = grpcClientWith(
            success([{ returnValues: [{ value: { value: 'AQI=' } }, output('u64', [3])] }]),
        );
        const result = await devInspectTransactionBlock(grpcClient, [
            SENDER,
            await buildKindBytes(),
        ]);
        expect(result).toEqual({
            error: null,
            results: [
                {
                    returnValues: [
                        [[1, 2], ''],
                        [[3], 'u64'],
                    ],
                },
            ],
        });
    });

    it('rejects a missing simulated transaction', async () => {
        const grpcClient = grpcClientWith({
            $kind: 'Transaction',
            Transaction: undefined,
            protoJson: {},
        });
        await expect(
            devInspectTransactionBlock(grpcClient, [SENDER, await buildKindBytes()]),
        ).rejects.toThrow('missing simulated transaction');
    });

    it.each(['value'] as const)(
        'rejects a missing return-value %s instead of silently dropping it',
        async (field) => {
            const value: Record<string, string> = { name: 'u64', value: 'AQ==' };
            delete value[field];
            const grpcClient = grpcClientWith(success([{ returnValues: [{ value }] }]));
            await expect(
                devInspectTransactionBlock(grpcClient, [SENDER, await buildKindBytes()]),
            ).rejects.toThrow(`returnValue.${field}`);
        },
    );
});
