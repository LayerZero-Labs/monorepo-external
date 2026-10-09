import { GrpcTypes } from '@mysten/sui-v2/grpc';
import { RpcError } from '@protobuf-ts/runtime-rpc';
import { describe, expect, it, vi } from 'vitest';

import { isSuiCompatProviderSpecificError } from '../errors';
import type { QueryEventsGrpcClient } from './queryEvents';
import { queryEvents } from './queryEvents';

const asyncIterableOf = <T>(items: readonly T[]): AsyncIterable<T> => ({
    [Symbol.asyncIterator]: async function* () {
        for (const item of items) yield item;
    },
});

const rawEvent = (overrides: Record<string, unknown> = {}) => ({
    eventType: '0x2::foo::Bar',
    packageId: '0x2',
    module: 'foo',
    sender: '0xsender',
    eventIndex: 0,
    transactionDigest: 'tx-1',
    json: undefined,
    contents: undefined,
    ...overrides,
});

// Shared by the {TimeRange} tests below: 10 checkpoints (0..9), timestamps in ms, spaced 10s
// apart — wide enough that the 3s boundary slack (TIME_RANGE_BOUNDARY_SLACK_MS) shifts the
// resolved checkpoint by at most one tie-pair, rather than swallowing the whole fixture.
// Deliberately not strictly increasing (cp0/cp1 and cp5/cp6 tie) to exercise the "first checkpoint
// AT OR AFTER" boundary search under non-strict monotonicity.
const CHECKPOINT_TIMESTAMPS_MS: Record<string, number> = {
    '0': 10_000,
    '1': 10_000,
    '2': 20_000,
    '3': 20_000,
    '4': 30_000,
    '5': 40_000,
    '6': 40_000,
    '7': 50_000,
    '8': 60_000,
    '9': 60_000,
};

const fakeCheckpointLookup = (): {
    getServiceInfo: ReturnType<typeof vi.fn>;
    getCheckpoint: ReturnType<typeof vi.fn>;
} => ({
    getServiceInfo: vi.fn().mockResolvedValue({
        response: { checkpointHeight: 9n, lowestAvailableCheckpoint: 0n },
    }),
    getCheckpoint: vi.fn().mockImplementation((request: unknown) => {
        const sequenceNumber = (
            request as { checkpointId: { sequenceNumber: bigint } }
        ).checkpointId.sequenceNumber.toString();
        const ms = CHECKPOINT_TIMESTAMPS_MS[sequenceNumber];
        return Promise.resolve({
            response: {
                checkpoint: { summary: { timestamp: { seconds: BigInt(ms / 1000), nanos: 0 } } },
            },
        });
    }),
});

const fakeTimeRangeClient = (
    listEventsResult: unknown[],
): { grpcClient: QueryEventsGrpcClient; listEvents: ReturnType<typeof vi.fn> } => {
    const listEvents = vi.fn().mockReturnValue({ responses: asyncIterableOf(listEventsResult) });

    return {
        grpcClient: {
            ledgerService: { ...fakeCheckpointLookup(), listEvents },
        } as unknown as QueryEventsGrpcClient,
        listEvents,
    };
};

describe('queryEvents', () => {
    it('rejects a filter shape it does not implement', async () => {
        const grpcClient = {} as QueryEventsGrpcClient;
        await expect(queryEvents(grpcClient, [{ Sender: '0xabc' }], undefined)).rejects.toThrow(
            /not yet supported/,
        );
    });

    it('rejects a negative or non-integer limit', async () => {
        const grpcClient = {} as QueryEventsGrpcClient;
        await expect(
            queryEvents(grpcClient, [{ Transaction: 'tx-1' }, null, -5, false], undefined),
        ).rejects.toThrow(/limit must be a non-negative integer/);
        await expect(
            queryEvents(grpcClient, [{ Transaction: 'tx-1' }, null, 1.5, false], undefined),
        ).rejects.toThrow(/limit must be a non-negative integer/);
    });

    it('treats limit: 0 as unset, matching legacy', async () => {
        const getTransaction = vi.fn().mockResolvedValue({
            response: {
                transaction: {
                    digest: 'tx-1',
                    events: { events: [rawEvent({ eventIndex: 0 })] },
                },
            },
        });
        const grpcClient = {
            ledgerService: { getTransaction },
        } as unknown as QueryEventsGrpcClient;

        const result = await queryEvents(
            grpcClient,
            [{ Transaction: 'tx-1' }, null, 0, false],
            undefined,
        );

        expect(result.data).toHaveLength(1);
    });

    describe('{Transaction}', () => {
        it('slices the transaction-embedded events client-side and paginates by index', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: {
                    transaction: {
                        digest: 'tx-1',
                        events: {
                            events: [
                                rawEvent({ eventIndex: undefined }),
                                rawEvent({ eventIndex: undefined }),
                                rawEvent({ eventIndex: undefined }),
                            ],
                        },
                    },
                },
            });
            const grpcClient = {
                ledgerService: { getTransaction },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [{ Transaction: 'tx-1' }, null, 2, false],
                undefined,
            );

            expect(result.hasNextPage).toBe(true);
            expect(result.data).toHaveLength(2);
            expect(result.data.map((event) => event.id.eventSeq)).toEqual(['0', '1']);
            expect(result.nextCursor).toEqual({ txDigest: 'tx-1', eventSeq: '1' });
        });

        it('throws when the transaction is not found, matching legacy', async () => {
            const rpcError = new RpcError('not found', 'NOT_FOUND');
            const getTransaction = vi.fn().mockRejectedValue(rpcError);
            const grpcClient = {
                ledgerService: { getTransaction },
            } as unknown as QueryEventsGrpcClient;

            await expect(
                queryEvents(grpcClient, [{ Transaction: 'missing' }, null, null, false], undefined),
            ).rejects.toBe(rpcError);
        });

        it('throws a provider-specific error when the response carries no transaction at all', async () => {
            // Defends the case where a provider returns an empty response instead of the
            // NOT_FOUND status the code above assumes — same condition, different shape.
            const getTransaction = vi
                .fn()
                .mockResolvedValue({ response: { transaction: undefined } });
            const grpcClient = {
                ledgerService: { getTransaction },
            } as unknown as QueryEventsGrpcClient;

            await expect(
                queryEvents(grpcClient, [{ Transaction: 'missing' }, null, null, false], undefined),
            ).rejects.toSatisfy(isSuiCompatProviderSpecificError);
        });

        it('does not mark a digest-mismatch as provider-specific — it fails the same way on every provider', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: { transaction: { digest: 'other-digest', events: { events: [] } } },
            });
            const grpcClient = {
                ledgerService: { getTransaction },
            } as unknown as QueryEventsGrpcClient;

            await expect(
                queryEvents(grpcClient, [{ Transaction: 'tx-1' }, null, null, false], undefined),
            ).rejects.not.toSatisfy(isSuiCompatProviderSpecificError);
        });

        it('echoes the input cursor as nextCursor on an empty page, matching legacy', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: {
                    transaction: {
                        digest: 'tx-1',
                        events: { events: [rawEvent({ eventIndex: 0 })] },
                    },
                },
            });
            const grpcClient = {
                ledgerService: { getTransaction },
            } as unknown as QueryEventsGrpcClient;

            const cursor = { txDigest: 'tx-1', eventSeq: '0' };
            const result = await queryEvents(
                grpcClient,
                [{ Transaction: 'tx-1' }, cursor, null, false],
                undefined,
            );

            expect(result.data).toHaveLength(0);
            expect(result.nextCursor).toEqual(cursor);
        });

        it('caps a caller-provided limit above the legacy page size at 50', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: {
                    transaction: {
                        digest: 'tx-1',
                        events: {
                            events: Array.from({ length: 51 }, () =>
                                rawEvent({ eventIndex: undefined }),
                            ),
                        },
                    },
                },
            });
            const grpcClient = {
                ledgerService: { getTransaction },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [{ Transaction: 'tx-1' }, null, 500, false],
                undefined,
            );

            expect(result.data).toHaveLength(50);
            expect(result.hasNextPage).toBe(true);
        });
    });

    describe('{MoveEventType}', () => {
        it('requests events filtered by eventType and reports hasNextPage from the extra item', async () => {
            const listEvents = vi.fn().mockReturnValue({
                responses: asyncIterableOf([
                    { event: rawEvent({ eventIndex: 0, transactionDigest: 'tx-1' }) },
                    { event: rawEvent({ eventIndex: 1, transactionDigest: 'tx-2' }) },
                ]),
            });
            const grpcClient = {
                ledgerService: { listEvents },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [{ MoveEventType: '0x2::foo::Bar' }, null, 1, false],
                undefined,
            );

            expect(listEvents).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    filter: {
                        terms: [
                            {
                                literals: [
                                    {
                                        negated: false,
                                        predicate: {
                                            oneofKind: 'eventType',
                                            eventType: { eventType: '0x2::foo::Bar' },
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
            expect(result.hasNextPage).toBe(true);
        });

        it('echoes the input cursor as nextCursor on an empty page, matching legacy', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: { transaction: { checkpoint: 42n } },
            });
            const watermarkCursor = new Uint8Array([1, 1, 1]);
            const listEvents = vi
                .fn()
                // resolveResumeWatermark scans the cursor's own checkpoint and finds it.
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            event: rawEvent({ eventIndex: 0, transactionDigest: 'tx-1' }),
                            watermark: { cursor: watermarkCursor },
                        },
                    ]),
                })
                // The actual resumed page: nothing new past the cursor.
                .mockReturnValueOnce({ responses: asyncIterableOf([]) });
            const grpcClient = {
                ledgerService: { getTransaction, listEvents },
            } as unknown as QueryEventsGrpcClient;

            const cursor = { txDigest: 'tx-1', eventSeq: '0' };
            const result = await queryEvents(
                grpcClient,
                [{ MoveEventType: '0x2::foo::Bar' }, cursor, null, false],
                undefined,
            );

            // nextCursor falls back to the original EventId cursor, not the resolved gRPC
            // watermark (a Uint8Array) used internally to drive the resumed request.
            expect(result.data).toHaveLength(0);
            expect(result.nextCursor).toEqual(cursor);
        });

        it('caps a caller-provided limit above the legacy page size at 50', async () => {
            // 51 events on the wire — one more than the cap, to prove the excess is dropped and
            // reported via hasNextPage rather than silently returned.
            const listEvents = vi.fn().mockReturnValue({
                responses: asyncIterableOf(
                    Array.from({ length: 51 }, (_, index) =>
                        rawEvent({ eventIndex: index, transactionDigest: `tx-${index}` }),
                    ).map((event) => ({ event })),
                ),
            });
            const grpcClient = {
                ledgerService: { listEvents },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [{ MoveEventType: '0x2::foo::Bar' }, null, 500, false],
                undefined,
            );

            // Legacy caps at 50 no matter what limit is requested — the gRPC wire request must
            // ask for 50 (+1 to detect hasNextPage), not the caller's 500.
            expect(listEvents).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ options: expect.objectContaining({ limit: 51 }) }),
                expect.anything(),
            );
            expect(result.data).toHaveLength(50);
            expect(result.hasNextPage).toBe(true);
        });

        it('resumes the listEvents scan when the server stops early on SCAN_LIMIT', async () => {
            // The scan budget can be exhausted before finding any matching event at all — the
            // terminal SCAN_LIMIT frame carries no item, only a resumable watermark.
            const scanFrontier = new Uint8Array([5, 5, 5]);
            const listEvents = vi
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
                    responses: asyncIterableOf([
                        { event: rawEvent({ eventIndex: 0, transactionDigest: 'tx-1' }) },
                    ]),
                });
            const grpcClient = {
                ledgerService: { listEvents },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [{ MoveEventType: '0x2::foo::Bar' }, null, 1, false],
                undefined,
            );

            expect(listEvents).toHaveBeenCalledTimes(2);
            expect(listEvents).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    options: expect.objectContaining({ after: scanFrontier }),
                }),
                expect.anything(),
            );
            expect(result.data).toHaveLength(1);
            expect(result.hasNextPage).toBe(false);
        });

        it('resumes the listEvents scan when the server stops early on ITEM_LIMIT', async () => {
            // Same resumable-frontier situation as SCAN_LIMIT above, just a different budget the
            // server can run out of first.
            const itemFrontier = new Uint8Array([6, 6, 6]);
            const listEvents = vi
                .fn()
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            watermark: { cursor: itemFrontier },
                            end: { reason: GrpcTypes.QueryEndReason.ITEM_LIMIT },
                        },
                    ]),
                })
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        { event: rawEvent({ eventIndex: 0, transactionDigest: 'tx-1' }) },
                    ]),
                });
            const grpcClient = {
                ledgerService: { listEvents },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [{ MoveEventType: '0x2::foo::Bar' }, null, 1, false],
                undefined,
            );

            expect(listEvents).toHaveBeenCalledTimes(2);
            expect(listEvents).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    options: expect.objectContaining({ after: itemFrontier }),
                }),
                expect.anything(),
            );
            expect(result.data).toHaveLength(1);
        });

        it('resolves a cursor to a gRPC watermark before resuming the ascending stream', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: { transaction: { checkpoint: 42n } },
            });
            const watermarkCursor = new Uint8Array([9, 9, 9]);
            const listEvents = vi
                .fn()
                // First call: resolveResumeWatermark scans the cursor's own checkpoint.
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            event: rawEvent({ eventIndex: 3, transactionDigest: 'cursor-tx' }),
                            watermark: { cursor: watermarkCursor },
                        },
                    ]),
                })
                // Second call: the actual resumed page.
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        { event: rawEvent({ eventIndex: 4, transactionDigest: 'tx-next' }) },
                    ]),
                });
            const grpcClient = {
                ledgerService: { getTransaction, listEvents },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [
                    { MoveEventType: '0x2::foo::Bar' },
                    { txDigest: 'cursor-tx', eventSeq: '3' },
                    10,
                    false,
                ],
                undefined,
            );

            expect(listEvents).toHaveBeenCalledTimes(2);
            expect(listEvents).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    options: expect.objectContaining({ after: watermarkCursor }),
                }),
                expect.anything(),
            );
            expect(result.data).toHaveLength(1);
            expect(result.data[0]?.id.txDigest).toBe('tx-next');
        });

        it('resolves a cursor to a gRPC watermark before resuming the descending stream', async () => {
            // Mirrors the ascending case above, but resuming descending drives the watermark
            // through `before` instead of `after` — unconfirmed live whether the server's
            // `before` boundary is exclusive of the cursor event the same way `after` is.
            const getTransaction = vi.fn().mockResolvedValue({
                response: { transaction: { checkpoint: 42n } },
            });
            const watermarkCursor = new Uint8Array([9, 9, 9]);
            const listEvents = vi
                .fn()
                // First call: resolveResumeWatermark scans the cursor's own checkpoint (always
                // ascending, regardless of the query's own order).
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            event: rawEvent({ eventIndex: 3, transactionDigest: 'cursor-tx' }),
                            watermark: { cursor: watermarkCursor },
                        },
                    ]),
                })
                // Second call: the actual resumed page, descending.
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        { event: rawEvent({ eventIndex: 2, transactionDigest: 'tx-prev' }) },
                    ]),
                });
            const grpcClient = {
                ledgerService: { getTransaction, listEvents },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [
                    { MoveEventType: '0x2::foo::Bar' },
                    { txDigest: 'cursor-tx', eventSeq: '3' },
                    10,
                    true, // descending
                ],
                undefined,
            );

            expect(listEvents).toHaveBeenCalledTimes(2);
            expect(listEvents).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    options: expect.objectContaining({
                        before: watermarkCursor,
                        ordering: GrpcTypes.Ordering.DESCENDING,
                    }),
                }),
                expect.anything(),
            );
            expect(result.data).toHaveLength(1);
            expect(result.data[0]?.id.txDigest).toBe('tx-prev');
        });

        it('keeps paging within the cursor checkpoint when the scan hits the item limit before finding it', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: { transaction: { checkpoint: 42n } },
            });
            const midWatermark = new Uint8Array([1, 1, 1]);
            const foundWatermark = new Uint8Array([2, 2, 2]);
            const listEvents = vi
                .fn()
                // First page of the checkpoint scan: hits the server's item limit without
                // reaching the cursor event.
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            event: rawEvent({ eventIndex: 0, transactionDigest: 'other-tx' }),
                            watermark: { cursor: midWatermark },
                            end: { reason: GrpcTypes.QueryEndReason.ITEM_LIMIT },
                        },
                    ]),
                })
                // Resumed page (after=midWatermark): finds the cursor event.
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            event: rawEvent({ eventIndex: 3, transactionDigest: 'cursor-tx' }),
                            watermark: { cursor: foundWatermark },
                        },
                    ]),
                })
                // Final page: the actual resumed query result.
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        { event: rawEvent({ eventIndex: 4, transactionDigest: 'tx-next' }) },
                    ]),
                });
            const grpcClient = {
                ledgerService: { getTransaction, listEvents },
            } as unknown as QueryEventsGrpcClient;

            const result = await queryEvents(
                grpcClient,
                [
                    { MoveEventType: '0x2::foo::Bar' },
                    { txDigest: 'cursor-tx', eventSeq: '3' },
                    10,
                    false,
                ],
                undefined,
            );

            expect(listEvents).toHaveBeenCalledTimes(3);
            expect(listEvents).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    options: expect.objectContaining({ after: midWatermark }),
                }),
                expect.anything(),
            );
            expect(listEvents).toHaveBeenNthCalledWith(
                3,
                expect.objectContaining({
                    options: expect.objectContaining({ after: foundWatermark }),
                }),
                expect.anything(),
            );
            expect(result.data[0]?.id.txDigest).toBe('tx-next');
        });
    });

    describe('{TimeRange}', () => {
        it('binary-searches the [startTime, endTime) window to a checkpoint range with no eventType filter', async () => {
            const { grpcClient, listEvents } = fakeTimeRangeClient([
                { event: rawEvent({ eventIndex: 0, transactionDigest: 'tx-a' }) },
            ]);

            const result = await queryEvents(
                grpcClient,
                [{ TimeRange: { startTime: '20000', endTime: '40000' } }, null, 50, false],
                undefined,
            );

            expect(listEvents).toHaveBeenCalledTimes(1);
            // With the 3s boundary slack, the search targets are 20000-3000=17000 and
            // 40000+3000=43000. cp2 is the first checkpoint with ts >= 17000 (cp1's ts=10000 is
            // too early); cp7 is the first with ts >= 43000 (cp5/cp6's ts=40000 is too early).
            expect(listEvents).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    startCheckpoint: 2n,
                    endCheckpoint: 7n,
                    filter: undefined,
                }),
                expect.anything(),
            );
            expect(result.data).toHaveLength(1);
        });

        it('lands on the first of two checkpoints sharing a timestamp (non-strict monotonicity)', async () => {
            const { grpcClient, listEvents } = fakeTimeRangeClient([]);

            // Ascending: start is unpadded (43000 lands exactly on the cp7 boundary, past the
            // cp5/cp6 tie at ts=40000); 57000+3000=60000 lands exactly on the cp8/cp9 tie.
            await queryEvents(
                grpcClient,
                [{ TimeRange: { startTime: '43000', endTime: '57000' } }, null, 50, false],
                undefined,
            );

            // cp7 is the first checkpoint at ts=50000 >= 43000; cp8 is the first of the cp8/cp9
            // tie at ts=60000.
            expect(listEvents).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({ startCheckpoint: 7n, endCheckpoint: 8n }),
                expect.anything(),
            );
        });

        it('skips the redundant startCheckpoint search when resuming ascending from a cursor', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: { transaction: { checkpoint: 4n } },
            });
            const watermarkCursor = new Uint8Array([7, 7, 7]);
            const listEvents = vi
                .fn()
                // resolveResumeWatermark scans the cursor's own checkpoint (cp4).
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            event: rawEvent({ eventIndex: 0, transactionDigest: 'cursor-tx' }),
                            watermark: { cursor: watermarkCursor },
                        },
                    ]),
                })
                // The actual resumed query.
                .mockReturnValueOnce({ responses: asyncIterableOf([]) });
            const grpcClient = {
                ledgerService: { ...fakeCheckpointLookup(), getTransaction, listEvents },
            } as unknown as QueryEventsGrpcClient;

            await queryEvents(
                grpcClient,
                [
                    { TimeRange: { startTime: '20000', endTime: '40000' } },
                    { txDigest: 'cursor-tx', eventSeq: '0' },
                    50,
                    false,
                ],
                undefined,
            );

            // Only the endCheckpoint binary search should run when resuming ascending — the
            // resume watermark's `after` already supersedes startCheckpoint.
            expect(listEvents).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    startCheckpoint: undefined,
                    endCheckpoint: 7n,
                    options: expect.objectContaining({ after: watermarkCursor }),
                }),
                expect.anything(),
            );
        });

        it('skips the redundant endCheckpoint search when resuming descending from a cursor', async () => {
            const getTransaction = vi.fn().mockResolvedValue({
                response: { transaction: { checkpoint: 6n } },
            });
            const watermarkCursor = new Uint8Array([8, 8, 8]);
            const listEvents = vi
                .fn()
                // resolveResumeWatermark scans the cursor's own checkpoint (cp6).
                .mockReturnValueOnce({
                    responses: asyncIterableOf([
                        {
                            event: rawEvent({ eventIndex: 0, transactionDigest: 'cursor-tx' }),
                            watermark: { cursor: watermarkCursor },
                        },
                    ]),
                })
                // The actual resumed query.
                .mockReturnValueOnce({ responses: asyncIterableOf([]) });
            const grpcClient = {
                ledgerService: { ...fakeCheckpointLookup(), getTransaction, listEvents },
            } as unknown as QueryEventsGrpcClient;

            await queryEvents(
                grpcClient,
                [
                    { TimeRange: { startTime: '20000', endTime: '40000' } },
                    { txDigest: 'cursor-tx', eventSeq: '0' },
                    50,
                    true, // descending
                ],
                undefined,
            );

            // Only the startCheckpoint binary search should run when resuming descending — the
            // resume watermark's `before` already supersedes endCheckpoint.
            expect(listEvents).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    startCheckpoint: 2n,
                    endCheckpoint: undefined,
                    options: expect.objectContaining({ before: watermarkCursor }),
                }),
                expect.anything(),
            );
        });
    });
});
