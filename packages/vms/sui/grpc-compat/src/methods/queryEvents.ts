import type { EventId, SuiClient, SuiEvent, SuiEventFilter } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { GrpcTypes } from '@mysten/sui-v2/grpc';

import { JSON_RPC, SuiCompatProviderSpecificError } from '../errors';
import { assertDefined, timestampToMs } from '../utils';
import { buildSuiEventFields } from './helpers/eventConversion';
import { resolvePageSize } from './helpers/paginatedCoins';
import { isResumableBudgetLimit, runResumableScan } from './helpers/resumableScan';

export type QueryEventsGrpcClient = Pick<SuiGrpcClient, 'ledgerService'>;
type V1PaginatedEvents = Awaited<ReturnType<SuiClient['queryEvents']>>;

const METHOD = 'queryEvents';

// All requested via readMask below, so a missing txDigest/eventIndex is a real problem worth
// surfacing loudly rather than silently defaulting to '' and returning a response that looks
// valid but isn't.
const toSuiEvent = (event: GrpcTypes.Event) =>
    ({
        id: {
            txDigest: assertDefined(event.transactionDigest, METHOD, 'events[].transactionDigest'),
            eventSeq: assertDefined(event.eventIndex, METHOD, 'events[].eventIndex').toString(),
        },
        ...buildSuiEventFields(event, METHOD),
    }) satisfies SuiEvent;

const filterAfterCursor = <T extends { eventIndex?: number }>(
    ordered: readonly T[],
    txDigest: string,
    cursor: EventId | null | undefined,
    descending: boolean,
): readonly T[] => {
    if (!cursor) return ordered;
    if (cursor.txDigest !== txDigest) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: cursor transaction ${cursor.txDigest} does not match the queried transaction ${txDigest}`,
        );
    }
    // EventId.eventSeq is a decimal string; parse it once to compare against eventIndex (number).
    const cursorSeq = Number(cursor.eventSeq);
    if (!Number.isInteger(cursorSeq)) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: cursor eventSeq "${cursor.eventSeq}" is not a valid integer`,
        );
    }
    return ordered.filter((event) => {
        const seq = event.eventIndex ?? 0;
        return descending ? seq < cursorSeq : seq > cursorSeq;
    });
};

// Shared by all three filter handlers below; each also takes its own filter-specific positional
// args (e.g. txDigest, the raw vs. already-resolved cursor) that don't fit this shape.
interface QueryPageOptions {
    limit: number | null | undefined;
    descending: boolean;
    signal: AbortSignal | undefined;
}

const queryEventsByTransaction = async (
    grpcClient: QueryEventsGrpcClient,
    txDigest: string,
    cursor: EventId | null | undefined,
    { limit, descending, signal }: QueryPageOptions,
): Promise<V1PaginatedEvents> => {
    if (!txDigest) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: {Transaction} filter requires a non-empty digest`,
        );
    }

    // Legacy throws for a transaction that doesn't exist ("Could not find the referenced
    // transaction"), so this lets the gRPC NOT_FOUND propagate the same way rather than degrading
    // it to an empty page — callers here (getLZSentEvent, executor-sdk) would otherwise silently
    // read a real error as "no events."
    const { response } = await grpcClient.ledgerService.getTransaction(
        { digest: txDigest, readMask: { paths: ['digest', 'events'] } },
        { abort: signal },
    );
    if (!response.transaction) {
        // A transaction this provider hasn't indexed yet, not a request-shape problem — must not
        // fall through to the digest-mismatch guard below. Same condition as
        // getTransactionBlock.ts's identical guard.
        throw new SuiCompatProviderSpecificError(
            `Sui gRPC compat ${METHOD}: transaction not found for digest ${txDigest}`,
            JSON_RPC.CallExecutionFailed,
        );
    }
    // Without this, a semi-trusted/buggy gRPC provider returning the wrong transaction would have
    // its events silently relabeled with the requested digest below.
    if (response.transaction.digest !== txDigest) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: response carried digest ${response.transaction.digest ?? '<missing>'} for requested digest ${txDigest} — cannot confirm this response is for the right transaction`,
        );
    }
    const events = response.transaction.events?.events ?? [];

    const withPosition = events.map((event, position) => ({
        ...event,
        eventIndex: position,
        transactionDigest: txDigest,
    }));

    const ordered = filterAfterCursor(
        descending ? [...withPosition].reverse() : withPosition,
        txDigest,
        cursor,
        descending,
    );

    const pageSize = resolvePageSize(limit);
    const hasNextPage = ordered.length > pageSize;
    // getTransaction returns a transaction's whole event list in one shot — there's no server-side
    // way to request a bounded slice of it, so pagination is client-side here.
    const page = ordered.slice(0, pageSize);

    const data = page.map(toSuiEvent);
    const last = data.at(-1);

    return {
        data,
        hasNextPage,
        // An empty page (cursor already at the end) echoes the input cursor back, matching
        // legacy, rather than nulling it out — callers that poll with a cursor (e.g.
        // aggregate-listener) keep resuming from the tip instead of restarting the scan.
        nextCursor: last ? last.id : (cursor ?? null),
    };
};

const buildMoveEventTypeFilter = (eventType: string): GrpcTypes.EventFilter => ({
    terms: [
        {
            literals: [
                {
                    negated: false,
                    predicate: { oneofKind: 'eventType', eventType: { eventType } },
                },
            ],
        },
    ],
});

const resolveResumeWatermark = async (
    grpcClient: QueryEventsGrpcClient,
    cursor: EventId,
    signal: AbortSignal | undefined,
    filter?: GrpcTypes.EventFilter,
): Promise<Uint8Array> => {
    const { response } = await grpcClient.ledgerService.getTransaction(
        { digest: cursor.txDigest, readMask: { paths: ['digest', 'checkpoint'] } },
        { abort: signal },
    );
    const checkpoint = response.transaction?.checkpoint;
    if (checkpoint === undefined) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: cursor transaction ${cursor.txDigest} has no checkpoint — cannot resume from it`,
        );
    }

    const context = `for cursor event ${cursor.txDigest}#${cursor.eventSeq}`;
    let after: Uint8Array | undefined;

    // A busy checkpoint can exceed the server's per-response item limit before reaching the
    // cursor event — keep resuming from the last watermark within this checkpoint until found or
    // genuinely exhausted (checked via the throw below, since that's a real error here, not a
    // normal stopping point).
    const found = await runResumableScan<Uint8Array>(
        signal,
        () => true,
        () => after,
        (watermark) => {
            after = watermark;
        },
        METHOD,
        context,
        async (attempt) => {
            const call = grpcClient.ledgerService.listEvents(
                {
                    readMask: { paths: ['transaction_digest', 'event_index'] },
                    startCheckpoint: checkpoint,
                    endCheckpoint: checkpoint + 1n,
                    filter,
                    options: { ordering: GrpcTypes.Ordering.ASCENDING, after },
                },
                { abort: attempt.signal },
            );

            let lastWatermark: Uint8Array | undefined;
            let hitBudgetLimit = false;

            for await (const frame of call.responses) {
                if (frame.watermark?.cursor) {
                    lastWatermark = frame.watermark.cursor;
                }
                if (
                    frame.event?.transactionDigest === cursor.txDigest &&
                    (frame.event.eventIndex ?? -1).toString() === cursor.eventSeq
                ) {
                    if (!frame.watermark?.cursor) {
                        throw new Error(
                            `Sui gRPC compat ${METHOD}: cursor event ${cursor.txDigest}#${cursor.eventSeq} carried no resumable watermark`,
                        );
                    }
                    attempt.abort();
                    return { result: frame.watermark.cursor, hitBudgetLimit: false, lastWatermark };
                }
                if (isResumableBudgetLimit(frame.end?.reason)) {
                    hitBudgetLimit = true;
                }
            }

            if (!hitBudgetLimit) {
                throw new Error(
                    `Sui gRPC compat ${METHOD}: could not locate cursor event ${cursor.txDigest}#${cursor.eventSeq} in checkpoint ${checkpoint} — cursor may belong to a different filter`,
                );
            }
            return { hitBudgetLimit, lastWatermark };
        },
    );

    // Unreachable in practice: `shouldContinue` is always true above, and the one case that would
    // otherwise fall through to `undefined` (a stream that ends without hitting a budget limit)
    // throws directly inside the attempt instead. Kept as an explicit guard rather than a
    // non-null assertion.
    if (found === undefined) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: could not locate cursor event ${cursor.txDigest}#${cursor.eventSeq}`,
        );
    }
    return found;
};

interface CheckpointBounds {
    startCheckpoint?: bigint;
    endCheckpoint?: bigint;
}

interface ExecuteListEventsOptions extends QueryPageOptions {
    filter: GrpcTypes.EventFilter | undefined;
    cursor: EventId | null | undefined;
    resumeCursor: Uint8Array | undefined;
    checkpointBounds?: CheckpointBounds;
}

const executeListEvents = async (
    grpcClient: QueryEventsGrpcClient,
    {
        filter,
        cursor,
        resumeCursor,
        limit,
        descending,
        signal,
        checkpointBounds,
    }: ExecuteListEventsOptions,
): Promise<V1PaginatedEvents> => {
    const pageSize = resolvePageSize(limit);
    // +1: fetch one extra item to detect hasNextPage without a second round trip.
    const desiredCount = pageSize + 1;

    const data: SuiEvent[] = [];
    let after = descending ? undefined : resumeCursor;
    let before = descending ? resumeCursor : undefined;

    await runResumableScan<never>(
        signal,
        () => data.length < desiredCount,
        () => (descending ? before : after),
        (watermark) => {
            if (descending) {
                before = watermark;
            } else {
                after = watermark;
            }
        },
        METHOD,
        'while scanning for events',
        async (attempt) => {
            const call = grpcClient.ledgerService.listEvents(
                {
                    readMask: {
                        paths: [
                            'package_id',
                            'module',
                            'sender',
                            'event_type',
                            'contents',
                            'json',
                            'transaction_digest',
                            'event_index',
                        ],
                    },
                    startCheckpoint: checkpointBounds?.startCheckpoint,
                    endCheckpoint: checkpointBounds?.endCheckpoint,
                    filter,
                    options: {
                        limit: desiredCount - data.length,
                        ordering: descending
                            ? GrpcTypes.Ordering.DESCENDING
                            : GrpcTypes.Ordering.ASCENDING,
                        after,
                        before,
                    },
                },
                { abort: attempt.signal },
            );

            let lastWatermark: Uint8Array | undefined;
            let hitBudgetLimit = false;

            for await (const frame of call.responses) {
                if (frame.watermark?.cursor) {
                    lastWatermark = frame.watermark.cursor;
                }
                if (frame.event) {
                    data.push(toSuiEvent(frame.event));
                    // A misbehaving provider that ignores `limit` shouldn't make this ingest an
                    // unbounded number of events into memory — the final page is sliced to
                    // `pageSize` regardless, so nothing past `desiredCount` is ever useful.
                    if (data.length >= desiredCount) {
                        attempt.abort();
                        break;
                    }
                }
                if (isResumableBudgetLimit(frame.end?.reason)) {
                    hitBudgetLimit = true;
                }
            }

            return { hitBudgetLimit, lastWatermark };
        },
    );

    const hasNextPage = data.length > pageSize;
    const page = hasNextPage ? data.slice(0, pageSize) : data;
    const last = page.at(-1);

    return {
        data: page,
        hasNextPage,
        nextCursor: last ? last.id : (cursor ?? null),
    };
};

const queryEventsByMoveEventType = async (
    grpcClient: QueryEventsGrpcClient,
    eventType: string,
    cursor: EventId | null | undefined,
    options: QueryPageOptions,
): Promise<V1PaginatedEvents> => {
    const filter = buildMoveEventTypeFilter(eventType);
    const resumeCursor = cursor
        ? await resolveResumeWatermark(grpcClient, cursor, options.signal, filter)
        : undefined;

    return executeListEvents(grpcClient, { filter, cursor, resumeCursor, ...options });
};

const getCheckpointTimestampMs = async (
    grpcClient: QueryEventsGrpcClient,
    sequenceNumber: bigint,
    signal: AbortSignal | undefined,
): Promise<bigint> => {
    const { response } = await grpcClient.ledgerService.getCheckpoint(
        {
            checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber },
            readMask: { paths: ['summary.timestamp'] },
        },
        { abort: signal },
    );
    const timestamp = response.checkpoint?.summary?.timestamp;
    if (!timestamp) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: checkpoint ${sequenceNumber} has no summary.timestamp — cannot resolve a TimeRange filter against it`,
        );
    }
    return BigInt(timestampToMs(timestamp));
};

// `EventFilter` has no time predicate, so a `{TimeRange}` filter is resolved by binary-searching
// checkpoint sequence numbers for the timestamp boundary. Checkpoint timestamps aren't strictly
// increasing (ties are possible), so this finds the FIRST checkpoint at or after `targetMs`.
const firstCheckpointAtOrAfter = async (
    grpcClient: QueryEventsGrpcClient,
    targetMs: bigint,
    lowestCheckpoint: bigint,
    latestCheckpoint: bigint,
    signal: AbortSignal | undefined,
): Promise<bigint> => {
    let lo = lowestCheckpoint;
    let hi = latestCheckpoint + 1n; // exclusive sentinel: "past the chain tip"

    while (lo < hi) {
        const mid = lo + (hi - lo) / 2n;
        const midMs = await getCheckpointTimestampMs(grpcClient, mid, signal);
        if (midMs >= targetMs) {
            hi = mid;
        } else {
            lo = mid + 1n;
        }
    }

    return lo;
};

// Padding a boundary outward absorbs legacy's ~600ms {TimeRange} clock skew, but only on the far
// boundary (end when ascending, start when descending) — padding the near boundary would prepend
// unrelated events ahead of the real target and could push it out of the LEGACY_MAX_PAGE_SIZE page
// entirely, which is the larger correctness risk.
const TIME_RANGE_BOUNDARY_SLACK_MS = 3_000n;

interface TimeRangeCheckpointOptions {
    startTimeMs: bigint;
    endTimeMs: bigint;
    descending: boolean;
    signal: AbortSignal | undefined;
    // A resume cursor's after/before bound is already tighter than any timestamp-derived
    // checkpoint, so the boundary it supersedes (start for ascending, end for descending) can be
    // skipped, halving the binary searches per paginated call.
    skip: { start?: boolean; end?: boolean };
}

const resolveCheckpointRangeForTimeRange = async (
    grpcClient: QueryEventsGrpcClient,
    { startTimeMs, endTimeMs, descending, signal, skip }: TimeRangeCheckpointOptions,
): Promise<CheckpointBounds> => {
    const { response } = await grpcClient.ledgerService.getServiceInfo({}, { abort: signal });
    if (response.checkpointHeight === undefined) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: missing checkpointHeight from gRPC response — cannot resolve a TimeRange filter`,
        );
    }
    // If startTimeMs predates the node's retention window, the search below clamps to this rather
    // than erroring — the same best-effort behavior any pruned full node would give.
    const lowestCheckpoint = response.lowestAvailableCheckpoint ?? 0n;
    const latestCheckpoint = response.checkpointHeight;

    // The two binary searches are independent, but a genuine failure in one (a bad response, a
    // real transport error) shouldn't leave the other one running unbounded — an internal
    // controller ties them together without affecting the caller's own AbortSignal.
    const internalController = new AbortController();
    const onOuterAbort = (): void => internalController.abort(signal?.reason);
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    const search = (targetMs: bigint): Promise<bigint> =>
        firstCheckpointAtOrAfter(
            grpcClient,
            targetMs,
            lowestCheckpoint,
            latestCheckpoint,
            internalController.signal,
        ).catch((error: unknown) => {
            internalController.abort();
            throw error;
        });

    try {
        // `{TimeRange}` is `[startTime, endTime)`, matching `ListEventsRequest`'s own
        // `[startCheckpoint, endCheckpoint)` convention exactly.
        const [startCheckpoint, endCheckpoint] = await Promise.all([
            skip.start
                ? Promise.resolve(undefined)
                : search(descending ? startTimeMs - TIME_RANGE_BOUNDARY_SLACK_MS : startTimeMs),
            skip.end
                ? Promise.resolve(undefined)
                : search(descending ? endTimeMs : endTimeMs + TIME_RANGE_BOUNDARY_SLACK_MS),
        ]);

        return { startCheckpoint, endCheckpoint };
    } finally {
        signal?.removeEventListener('abort', onOuterAbort);
    }
};

const queryEventsByTimeRange = async (
    grpcClient: QueryEventsGrpcClient,
    startTime: string,
    endTime: string,
    cursor: EventId | null | undefined,
    options: QueryPageOptions,
): Promise<V1PaginatedEvents> => {
    const { descending, signal } = options;
    const checkpointBounds = await resolveCheckpointRangeForTimeRange(grpcClient, {
        startTimeMs: BigInt(startTime),
        endTimeMs: BigInt(endTime),
        descending,
        signal,
        skip: cursor ? (descending ? { end: true } : { start: true }) : {},
    });

    const resumeCursor = cursor
        ? await resolveResumeWatermark(grpcClient, cursor, signal)
        : undefined;

    return executeListEvents(grpcClient, {
        filter: undefined,
        cursor,
        resumeCursor,
        checkpointBounds,
        ...options,
    });
};

// Only {Transaction}, {MoveEventType}, and {TimeRange} have real production callers; every other
// SuiEventFilter shape (Sender/MoveModule/MoveEventModule/All/Any) falls through to the error
// below.
export const queryEvents = async (
    grpcClient: QueryEventsGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1PaginatedEvents> => {
    const [query, cursor, limitArg, descendingArg] = params as [
        SuiEventFilter,
        EventId | null | undefined,
        number | null | undefined,
        boolean | undefined,
    ];
    // 0 is falsy, so it already means "no limit" via resolvePageSize's `limit ? ... : LEGACY_MAX_PAGE_SIZE`
    // below — matching legacy, which also treats limit: 0 as unset and returns a full default page.
    if (limitArg != null && (!Number.isInteger(limitArg) || limitArg < 0)) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: limit must be a non-negative integer, received ${JSON.stringify(limitArg)}`,
        );
    }
    const options: QueryPageOptions = {
        limit: limitArg,
        descending: Boolean(descendingArg),
        signal,
    };

    if ('Transaction' in query) {
        return queryEventsByTransaction(grpcClient, query.Transaction, cursor, options);
    }

    if ('MoveEventType' in query) {
        return queryEventsByMoveEventType(grpcClient, query.MoveEventType, cursor, options);
    }

    if ('TimeRange' in query) {
        return queryEventsByTimeRange(
            grpcClient,
            query.TimeRange.startTime,
            query.TimeRange.endTime,
            cursor,
            options,
        );
    }

    throw new Error(
        `Sui gRPC compat ${METHOD}: ${JSON.stringify(query)} is not yet supported — no production caller requests any filter shape besides {Transaction}, {MoveEventType} and {TimeRange}`,
    );
};
