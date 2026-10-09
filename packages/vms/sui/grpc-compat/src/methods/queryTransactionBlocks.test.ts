import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { describe, expect, it, vi } from 'vitest';

import type { QueryTransactionBlocksGrpcClient } from './queryTransactionBlocks';
import { queryTransactionBlocks } from './queryTransactionBlocks';

const asyncIterableOf = <T>(items: readonly T[]): AsyncIterable<T> => ({
    [Symbol.asyncIterator]: async function* () {
        for (const item of items) yield item;
    },
});

const rawTransaction = (overrides: Record<string, unknown> = {}) => ({
    digest: 'tx-1',
    checkpoint: 10n,
    timestamp: { seconds: 1_700_000_000n, nanos: 0 },
    effects: { status: { success: true } },
    ...overrides,
});

describe('queryTransactionBlocks', () => {
    it('rejects a filter shape it does not implement', async () => {
        const grpcClient = {} as QueryTransactionBlocksGrpcClient;
        await expect(
            queryTransactionBlocks(
                grpcClient,
                [{ filter: { FromAddress: '0xabc' } }, null, null, false],
                undefined,
            ),
        ).rejects.toThrow(/not yet supported/);
    });

    it('rejects a missing filter', async () => {
        const grpcClient = {} as QueryTransactionBlocksGrpcClient;
        await expect(
            queryTransactionBlocks(grpcClient, [{}, null, null, false], undefined),
        ).rejects.toThrow(/not yet supported/);
    });

    it('rejects a negative or non-integer limit', async () => {
        const grpcClient = {} as QueryTransactionBlocksGrpcClient;
        const query = { filter: { MoveFunction: { package: '0x2' } } };
        await expect(
            queryTransactionBlocks(grpcClient, [query, null, -5, false], undefined),
        ).rejects.toThrow(/limit must be a non-negative integer/);
        await expect(
            queryTransactionBlocks(grpcClient, [query, null, 1.5, false], undefined),
        ).rejects.toThrow(/limit must be a non-negative integer/);
    });

    it('rejects unsupported response options', async () => {
        const grpcClient = {} as QueryTransactionBlocksGrpcClient;
        const query = {
            filter: { MoveFunction: { package: '0x2' } },
            options: { showRawEffects: true },
        };
        await expect(
            queryTransactionBlocks(grpcClient, [query, null, null, false], undefined),
        ).rejects.toThrow(/not yet supported/);
    });

    it('rejects a {MoveFunction} filter with a function but no module', async () => {
        const grpcClient = {} as QueryTransactionBlocksGrpcClient;
        const query = { filter: { MoveFunction: { package: '0x2', function: 'init_oft' } } };
        await expect(
            queryTransactionBlocks(grpcClient, [query, null, null, false], undefined),
        ).rejects.toThrow(/without a module/);
    });

    it('requests transactions filtered by the full package::module::function Move path', async () => {
        const listTransactions = vi.fn().mockReturnValue({
            responses: asyncIterableOf([{ transaction: rawTransaction() }]),
        });
        const grpcClient = {
            ledgerService: { listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        const query = {
            filter: {
                MoveFunction: { package: '0x2', module: 'oft_impl', function: 'init_oft' },
            },
            options: { showObjectChanges: true },
        };
        listTransactions.mockReturnValue({
            responses: asyncIterableOf([
                { transaction: rawTransaction({ transaction: { sender: '0xsender' } }) },
            ]),
        });

        const result = await queryTransactionBlocks(grpcClient, [query, null, 1, false], undefined);

        expect(listTransactions).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                filter: {
                    terms: [
                        {
                            literals: [
                                {
                                    negated: false,
                                    predicate: {
                                        oneofKind: 'moveCall',
                                        moveCall: { function: '0x2::oft_impl::init_oft' },
                                    },
                                },
                            ],
                        },
                    ],
                },
            }),
            expect.anything(),
        );
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.digest).toBe('tx-1');
    });

    it('builds a package-only Move path when module and function are omitted', async () => {
        const listTransactions = vi.fn().mockReturnValue({
            responses: asyncIterableOf([{ transaction: rawTransaction() }]),
        });
        const grpcClient = {
            ledgerService: { listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        await queryTransactionBlocks(
            grpcClient,
            [{ filter: { MoveFunction: { package: '0x2' } } }, null, 1, false],
            undefined,
        );

        expect(listTransactions).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                filter: {
                    terms: [
                        {
                            literals: [
                                {
                                    negated: false,
                                    predicate: {
                                        oneofKind: 'moveCall',
                                        moveCall: { function: '0x2' },
                                    },
                                },
                            ],
                        },
                    ],
                },
            }),
            expect.anything(),
        );
    });

    it('reports hasNextPage from the extra item fetched on the wire', async () => {
        const listTransactions = vi.fn().mockReturnValue({
            responses: asyncIterableOf([
                { transaction: rawTransaction({ digest: 'tx-1' }) },
                { transaction: rawTransaction({ digest: 'tx-2' }) },
            ]),
        });
        const grpcClient = {
            ledgerService: { listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        const result = await queryTransactionBlocks(
            grpcClient,
            [{ filter: { MoveFunction: { package: '0x2' } } }, null, 1, false],
            undefined,
        );

        expect(result.data).toHaveLength(1);
        expect(result.hasNextPage).toBe(true);
        expect(result.nextCursor).toBe('tx-1');
    });

    it('caps a caller-provided limit above the legacy page size at 50', async () => {
        const listTransactions = vi.fn().mockReturnValue({
            responses: asyncIterableOf(
                Array.from({ length: 51 }, (_, index) => ({
                    transaction: rawTransaction({ digest: `tx-${index}` }),
                })),
            ),
        });
        const grpcClient = {
            ledgerService: { listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        const result = await queryTransactionBlocks(
            grpcClient,
            [{ filter: { MoveFunction: { package: '0x2' } } }, null, 500, false],
            undefined,
        );

        expect(listTransactions).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ options: expect.objectContaining({ limit: 51 }) }),
            expect.anything(),
        );
        expect(result.data).toHaveLength(50);
        expect(result.hasNextPage).toBe(true);
    });

    it('echoes the input cursor as nextCursor on an empty page, matching legacy', async () => {
        const getTransaction = vi.fn().mockResolvedValue({
            response: { transaction: { checkpoint: 42n } },
        });
        const watermarkCursor = new Uint8Array([1, 1, 1]);
        const listTransactions = vi
            .fn()
            // resolveResumeWatermark scans the cursor's own checkpoint and finds it.
            .mockReturnValueOnce({
                responses: asyncIterableOf([
                    { transaction: { digest: 'tx-1' }, watermark: { cursor: watermarkCursor } },
                ]),
            })
            // The actual resumed page: nothing new past the cursor.
            .mockReturnValueOnce({ responses: asyncIterableOf([]) });
        const grpcClient = {
            ledgerService: { getTransaction, listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        const result = await queryTransactionBlocks(
            grpcClient,
            [{ filter: { MoveFunction: { package: '0x2' } } }, 'tx-1', null, false],
            undefined,
        );

        expect(result.data).toHaveLength(0);
        expect(result.nextCursor).toBe('tx-1');
    });

    it('resolves a cursor to a gRPC watermark before resuming the ascending stream', async () => {
        const getTransaction = vi.fn().mockResolvedValue({
            response: { transaction: { checkpoint: 42n } },
        });
        const watermarkCursor = new Uint8Array([9, 9, 9]);
        const listTransactions = vi
            .fn()
            // First call: resolveResumeWatermark scans the cursor's own checkpoint.
            .mockReturnValueOnce({
                responses: asyncIterableOf([
                    {
                        transaction: { digest: 'cursor-tx' },
                        watermark: { cursor: watermarkCursor },
                    },
                ]),
            })
            // Second call: the actual resumed page.
            .mockReturnValueOnce({
                responses: asyncIterableOf([
                    { transaction: rawTransaction({ digest: 'tx-next' }) },
                ]),
            });
        const grpcClient = {
            ledgerService: { getTransaction, listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        const result = await queryTransactionBlocks(
            grpcClient,
            [{ filter: { MoveFunction: { package: '0x2' } } }, 'cursor-tx', 10, false],
            undefined,
        );

        expect(listTransactions).toHaveBeenCalledTimes(2);
        expect(listTransactions).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                options: expect.objectContaining({ after: watermarkCursor }),
            }),
            expect.anything(),
        );
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.digest).toBe('tx-next');
    });

    it('resumes the listTransactions scan when the server stops early on SCAN_LIMIT', async () => {
        const scanFrontier = new Uint8Array([5, 5, 5]);
        const listTransactions = vi
            .fn()
            .mockReturnValueOnce({
                responses: asyncIterableOf([
                    {
                        watermark: { cursor: scanFrontier },
                        end: { reason: GrpcTypes.QueryEndReason.SCAN_LIMIT },
                    },
                ]),
            })
            .mockReturnValueOnce({
                responses: asyncIterableOf([{ transaction: rawTransaction({ digest: 'tx-1' }) }]),
            });
        const grpcClient = {
            ledgerService: { listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        const result = await queryTransactionBlocks(
            grpcClient,
            [{ filter: { MoveFunction: { package: '0x2' } } }, null, 1, false],
            undefined,
        );

        expect(listTransactions).toHaveBeenCalledTimes(2);
        expect(listTransactions).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ options: expect.objectContaining({ after: scanFrontier }) }),
            expect.anything(),
        );
        expect(result.data).toHaveLength(1);
        expect(result.hasNextPage).toBe(false);
    });

    it('resumes the listTransactions scan descending using before, matching queryEvents', async () => {
        const getTransaction = vi.fn().mockResolvedValue({
            response: { transaction: { checkpoint: 6n } },
        });
        const watermarkCursor = new Uint8Array([8, 8, 8]);
        const listTransactions = vi
            .fn()
            .mockReturnValueOnce({
                responses: asyncIterableOf([
                    {
                        transaction: { digest: 'cursor-tx' },
                        watermark: { cursor: watermarkCursor },
                    },
                ]),
            })
            .mockReturnValueOnce({
                responses: asyncIterableOf([
                    { transaction: rawTransaction({ digest: 'tx-prev' }) },
                ]),
            });
        const grpcClient = {
            ledgerService: { getTransaction, listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        const result = await queryTransactionBlocks(
            grpcClient,
            [{ filter: { MoveFunction: { package: '0x2' } } }, 'cursor-tx', 10, true],
            undefined,
        );

        expect(listTransactions).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                options: expect.objectContaining({
                    before: watermarkCursor,
                    ordering: GrpcTypes.Ordering.DESCENDING,
                }),
            }),
            expect.anything(),
        );
        expect(result.data[0]?.digest).toBe('tx-prev');
    });

    it('throws when the cursor transaction cannot be located within its checkpoint', async () => {
        const getTransaction = vi.fn().mockResolvedValue({
            response: { transaction: { checkpoint: 42n } },
        });
        const listTransactions = vi.fn().mockReturnValueOnce({
            responses: asyncIterableOf([{ transaction: { digest: 'other-tx' } }]),
        });
        const grpcClient = {
            ledgerService: { getTransaction, listTransactions },
        } as unknown as QueryTransactionBlocksGrpcClient;

        await expect(
            queryTransactionBlocks(
                grpcClient,
                [{ filter: { MoveFunction: { package: '0x2' } } }, 'cursor-tx', 10, false],
                undefined,
            ),
        ).rejects.toThrow(/could not locate cursor transaction/);
    });
});
