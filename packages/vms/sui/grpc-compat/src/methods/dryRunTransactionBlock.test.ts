import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { toBase64 } from '@mysten/sui-v2/utils';
import { describe, expect, it, vi } from 'vitest';

import type { DryRunTransactionBlockGrpcClient } from './dryRunTransactionBlock';
import { dryRunTransactionBlock } from './dryRunTransactionBlock';

const TX_BYTES = toBase64(new Uint8Array([1, 2, 3]));

const grpcClientWith = (
    // Partial fixtures only set the fields the mapper reads.
    simulateTransaction: () => Promise<unknown>,
): DryRunTransactionBlockGrpcClient => ({
    simulateTransaction: vi.fn(
        simulateTransaction,
    ) as unknown as SuiGrpcClient['simulateTransaction'],
});

const GAS_USED = {
    computationCost: '1000',
    storageCost: '2000',
    storageRebate: '500',
    nonRefundableStorageFee: '0',
};

describe('dryRunTransactionBlock', () => {
    it('maps a successful simulation to legacy effects.status and gasUsed', async () => {
        const grpcClient = grpcClientWith(async () => ({
            $kind: 'Transaction',
            Transaction: {
                status: { success: true, error: null },
                effects: { gasUsed: GAS_USED },
            },
        }));

        const result = await dryRunTransactionBlock(grpcClient, [TX_BYTES], undefined);

        // Mysten Transaction.build() → setGasBudget reads these gasUsed fields.
        expect(result).toEqual({
            effects: { status: { status: 'success' }, gasUsed: GAS_USED },
        });
        expect(grpcClient.simulateTransaction).toHaveBeenCalledWith(
            expect.objectContaining({
                include: { effects: true },
                signal: undefined,
            }),
        );
    });

    it('throws when a successful simulation is missing gasUsed', async () => {
        const grpcClient = grpcClientWith(async () => ({
            $kind: 'Transaction',
            Transaction: { status: { success: true, error: null } },
        }));

        await expect(dryRunTransactionBlock(grpcClient, [TX_BYTES], undefined)).rejects.toThrow(
            'effects.gasUsed',
        );
    });

    it('maps a failed simulation to legacy effects.status with the error message', async () => {
        const grpcClient = grpcClientWith(async () => ({
            $kind: 'FailedTransaction',
            FailedTransaction: {
                status: { success: false, error: { message: 'insufficient gas' } },
            },
        }));

        const result = await dryRunTransactionBlock(grpcClient, [TX_BYTES], undefined);

        expect(result).toEqual({
            effects: { status: { status: 'failure', error: 'insufficient gas' } },
        });
    });

    it('re-appends the numeric abort code when a Move #[error] constant hid it', async () => {
        const grpcClient = grpcClientWith(async () => ({
            $kind: 'FailedTransaction',
            FailedTransaction: {
                status: {
                    success: false,
                    error: {
                        $kind: 'MoveAbort',
                        message:
                            "MoveAbort in 1st command, 'ENoPrice', in '0x2::price_feed::get_price' (instruction 11)",
                        MoveAbort: { abortCode: '2', cleverError: { constantName: 'ENoPrice' } },
                    },
                },
            },
        }));

        const result = await dryRunTransactionBlock(grpcClient, [TX_BYTES], undefined);

        expect(result.effects.status).toMatchObject({ status: 'failure' });
        expect((result.effects.status as { error: string }).error).toContain('abort code: 2');
    });

    it('throws when the gRPC response has no simulated transaction at all', async () => {
        const grpcClient = grpcClientWith(async () => ({
            $kind: 'Transaction',
            Transaction: undefined,
        }));

        await expect(dryRunTransactionBlock(grpcClient, [TX_BYTES], undefined)).rejects.toThrow(
            'missing simulated transaction',
        );
    });
});
