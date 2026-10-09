import { GrpcTypes } from '@mysten/sui-v2/grpc';

// Bounds the resume scans below: a server that keeps ending a stream at the same frontier (a
// non-advancing watermark) would otherwise retry forever against the provider.
const MAX_WATERMARK_RESUME_ATTEMPTS = 1_000;

const watermarksEqual = (a: Uint8Array, b: Uint8Array): boolean =>
    a.length === b.length && a.every((byte, index) => byte === b[index]);

// A paginated list scan can end early because it hit a server-side budget, not because it's out
// of data — both resume scans in queryEvents.ts and queryTransactionBlocks.ts treat ITEM_LIMIT
// and SCAN_LIMIT identically for this reason.
export const isResumableBudgetLimit = (reason: GrpcTypes.QueryEndReason | undefined): boolean =>
    reason === GrpcTypes.QueryEndReason.ITEM_LIMIT ||
    reason === GrpcTypes.QueryEndReason.SCAN_LIMIT;

export const nextResumeWatermark = (
    lastWatermark: Uint8Array | undefined,
    previous: Uint8Array | undefined,
    method: string,
    context: string,
): Uint8Array => {
    if (!lastWatermark) {
        throw new Error(
            `Sui gRPC compat ${method}: hit a budget limit ${context} with no resumable watermark`,
        );
    }
    if (previous && watermarksEqual(lastWatermark, previous)) {
        throw new Error(
            `Sui gRPC compat ${method}: watermark did not advance while resuming ${context} — aborting instead of looping forever`,
        );
    }
    return lastWatermark;
};

export interface ScanAttemptOutcome<R> {
    /** A defined value stops the scan immediately with this as the final result. */
    result?: R;
    hitBudgetLimit: boolean;
    lastWatermark: Uint8Array | undefined;
}

/**
 * Shared control flow for the checkpoint-bounded resume scans in `queryEvents.ts` and
 * `queryTransactionBlocks.ts`: repeatedly runs one gRPC call via `runAttempt` — each attempt gets
 * its own `AbortController`, linked to the caller's `signal`, so an attempt that got what it
 * needed can cancel its own in-flight stream instead of leaving the server sending frames nobody
 * reads — until `runAttempt` returns a defined `result`, stops hitting a budget limit, or
 * `shouldContinue` says to stop.
 */
export const runResumableScan = async <R>(
    signal: AbortSignal | undefined,
    shouldContinue: () => boolean,
    getFrontier: () => Uint8Array | undefined,
    setFrontier: (watermark: Uint8Array) => void,
    method: string,
    context: string,
    runAttempt: (attempt: AbortController) => Promise<ScanAttemptOutcome<R>>,
): Promise<R | undefined> => {
    let attempts = 0;
    while (shouldContinue()) {
        if (attempts++ >= MAX_WATERMARK_RESUME_ATTEMPTS) {
            throw new Error(
                `Sui gRPC compat ${method}: exceeded ${MAX_WATERMARK_RESUME_ATTEMPTS} resume attempts ${context}`,
            );
        }

        const attempt = new AbortController();
        const onOuterAbort = (): void => attempt.abort(signal?.reason);
        signal?.addEventListener('abort', onOuterAbort, { once: true });

        let outcome: ScanAttemptOutcome<R>;
        try {
            outcome = await runAttempt(attempt);
        } finally {
            signal?.removeEventListener('abort', onOuterAbort);
        }

        if (outcome.result !== undefined) {
            return outcome.result;
        }
        if (!outcome.hitBudgetLimit) {
            return undefined;
        }
        setFrontier(nextResumeWatermark(outcome.lastWatermark, getFrontier(), method, context));
    }
    return undefined;
};
