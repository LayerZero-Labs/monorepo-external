import type { SuiClient, SuiTransactionBlockResponseQuery } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { GrpcTypes } from '@mysten/sui-v2/grpc';

import { LEGACY_MAX_PAGE_SIZE } from './helpers/paginatedCoins';
import { isResumableBudgetLimit, runResumableScan } from './helpers/resumableScan';
import {
    assertSupportedOptions,
    buildReadMask,
    buildTransactionBlockResult,
    type GrpcCompatTransactionBlock,
} from './helpers/transactionBlockResponse';

export type QueryTransactionBlocksGrpcClient = Pick<SuiGrpcClient, 'ledgerService'>;

const METHOD = 'queryTransactionBlocks';

type V1PaginatedTransactionBlocks = Omit<
    Awaited<ReturnType<SuiClient['queryTransactionBlocks']>>,
    'data'
> & { data: GrpcCompatTransactionBlock[] };

const resolvePageSize = (limit: number | null | undefined): number =>
    limit ? Math.min(limit, LEGACY_MAX_PAGE_SIZE) : LEGACY_MAX_PAGE_SIZE;

interface MoveFunctionFilter {
    package: string;
    module?: string | null;
    function?: string | null;
}

// Only {MoveFunction} has a real production caller (oft-activity-factory, replaying a chain's
// init_oft call to recover its MigrationCap) — every other TransactionFilter shape
// (Checkpoint/InputObject/ChangedObject/AffectedObject/FromAddress/ToAddress/FromAndToAddress/
// FromOrToAddress/TransactionKind/TransactionKindIn) falls through to the error below.
const buildMoveFunctionFilter = (moveFunction: MoveFunctionFilter): GrpcTypes.TransactionFilter => {
    const path = [moveFunction.package];
    if (moveFunction.module) path.push(moveFunction.module);
    if (moveFunction.function) {
        if (!moveFunction.module) {
            throw new Error(
                `Sui gRPC compat ${METHOD}: {MoveFunction} filter specifies a function without a module — cannot build a well-formed Move path`,
            );
        }
        path.push(moveFunction.function);
    }

    return {
        terms: [
            {
                literals: [
                    {
                        negated: false,
                        predicate: {
                            oneofKind: 'moveCall',
                            moveCall: { function: path.join('::') },
                        },
                    },
                ],
            },
        ],
    };
};

interface QueryPageOptions {
    limit: number | null | undefined;
    descending: boolean;
    signal: AbortSignal | undefined;
}

// Mirrors `queryEvents.ts`'s `resolveResumeWatermark`, but transactions have no positional index
// to re-check within a checkpoint (each frame is already one whole transaction) — finding the
// cursor transaction's watermark is enough to resume from.
const resolveResumeWatermark = async (
    grpcClient: QueryTransactionBlocksGrpcClient,
    cursor: string,
    filter: GrpcTypes.TransactionFilter,
    signal: AbortSignal | undefined,
): Promise<Uint8Array> => {
    const { response } = await grpcClient.ledgerService.getTransaction(
        { digest: cursor, readMask: { paths: ['digest', 'checkpoint'] } },
        { abort: signal },
    );
    const checkpoint = response.transaction?.checkpoint;
    if (checkpoint === undefined) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: cursor transaction ${cursor} has no checkpoint — cannot resume from it`,
        );
    }

    const context = `for cursor transaction ${cursor}`;
    let after: Uint8Array | undefined;

    // A busy checkpoint can exceed the server's per-response item limit before reaching the
    // cursor transaction — keep resuming from the last watermark within this checkpoint until
    // found or genuinely exhausted (checked via the throw below, since that's a real error here,
    // not a normal stopping point).
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
            const call = grpcClient.ledgerService.listTransactions(
                {
                    readMask: { paths: ['digest'] },
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
                if (frame.transaction?.digest === cursor) {
                    if (!frame.watermark?.cursor) {
                        throw new Error(
                            `Sui gRPC compat ${METHOD}: cursor transaction ${cursor} carried no resumable watermark`,
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
                    `Sui gRPC compat ${METHOD}: could not locate cursor transaction ${cursor} in checkpoint ${checkpoint} — cursor may belong to a different filter`,
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
        throw new Error(`Sui gRPC compat ${METHOD}: could not locate cursor transaction ${cursor}`);
    }
    return found;
};

interface ExecuteListTransactionsOptions extends QueryPageOptions {
    filter: GrpcTypes.TransactionFilter;
    cursor: string | null | undefined;
    resumeCursor: Uint8Array | undefined;
    responseOptions: SuiTransactionBlockResponseQuery['options'];
}

const executeListTransactions = async (
    grpcClient: QueryTransactionBlocksGrpcClient,
    {
        filter,
        cursor,
        resumeCursor,
        limit,
        descending,
        signal,
        responseOptions,
    }: ExecuteListTransactionsOptions,
): Promise<V1PaginatedTransactionBlocks> => {
    const pageSize = resolvePageSize(limit);
    // +1: fetch one extra item to detect hasNextPage without a second round trip.
    const desiredCount = pageSize + 1;
    const readMask = buildReadMask(responseOptions ?? undefined);

    const data: GrpcCompatTransactionBlock[] = [];
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
        'while scanning for transactions',
        async (attempt) => {
            const call = grpcClient.ledgerService.listTransactions(
                {
                    readMask: { paths: readMask },
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
                if (frame.transaction) {
                    const tx = frame.transaction;
                    if (!tx.digest) {
                        throw new Error(
                            `Sui gRPC compat ${METHOD}: response carried a transaction with no digest`,
                        );
                    }
                    data.push(
                        buildTransactionBlockResult(
                            tx,
                            tx.digest,
                            responseOptions ?? undefined,
                            METHOD,
                        ),
                    );
                    // A misbehaving provider that ignores `limit` shouldn't make this ingest an
                    // unbounded number of transactions into memory — the final page is sliced to
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
        // An empty page (cursor already at the end) echoes the input cursor back, matching
        // legacy, rather than nulling it out.
        nextCursor: last ? last.digest : (cursor ?? null),
    };
};

// Only {MoveFunction} is supported — see `buildMoveFunctionFilter`.
export const queryTransactionBlocks = async (
    grpcClient: QueryTransactionBlocksGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1PaginatedTransactionBlocks> => {
    const [query, cursor, limitArg, descendingArg] = params as [
        SuiTransactionBlockResponseQuery | undefined,
        string | null | undefined,
        number | null | undefined,
        boolean | undefined,
    ];

    assertSupportedOptions(query?.options ?? undefined, METHOD);

    // 0 is falsy, so it already means "no limit" via resolvePageSize's `limit ? ... : LEGACY_MAX_PAGE_SIZE`
    // below — matching legacy, which also treats limit: 0 as unset and returns a full default page.
    if (limitArg != null && (!Number.isInteger(limitArg) || limitArg < 0)) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: limit must be a non-negative integer, received ${JSON.stringify(limitArg)}`,
        );
    }

    const filterArg = query?.filter;
    if (!filterArg || !('MoveFunction' in filterArg)) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: ${JSON.stringify(filterArg ?? null)} is not yet supported — no production caller requests any filter shape besides {MoveFunction}`,
        );
    }

    const filter = buildMoveFunctionFilter(filterArg.MoveFunction);
    const options: QueryPageOptions = {
        limit: limitArg,
        descending: Boolean(descendingArg),
        signal,
    };

    const resumeCursor = cursor
        ? await resolveResumeWatermark(grpcClient, cursor, filter, signal)
        : undefined;

    return executeListTransactions(grpcClient, {
        filter,
        cursor,
        resumeCursor,
        responseOptions: query?.options,
        ...options,
    });
};
