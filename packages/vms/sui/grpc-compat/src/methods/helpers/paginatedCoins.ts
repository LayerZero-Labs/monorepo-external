import { toBase64 } from '@mysten/sui-v2/utils';

/**
 * Legacy caps several methods at 50 items per page regardless of the caller's `limit` —
 * `suix_getCoins`/`suix_getAllCoins` (coins), `suix_queryEvents` (events, see queryEvents.ts),
 * and `suix_queryTransactionBlocks` (transactions, see queryTransactionBlocks.ts). The gRPC
 * equivalents (`listCoins`/`listOwnedObjects`/`listEvents`/`listTransactions`) allow much larger
 * pages, so an uncapped `limit` (or none at all, which lets the gRPC default apply) mismatches
 * legacy even on page 1.
 */
export const LEGACY_MAX_PAGE_SIZE = 50;

/** Shared by every method `LEGACY_MAX_PAGE_SIZE` applies to — see the file-level comment above. */
export const resolvePageSize = (limit: number | null | undefined): number =>
    limit ? Math.min(limit, LEGACY_MAX_PAGE_SIZE) : LEGACY_MAX_PAGE_SIZE;

export interface PageTokenResult {
    nextCursor: string | null;
    hasNextPage: boolean;
}

/**
 * Shared by `getAllCoins.ts` and `getOwnedObjects.ts`, both of which call the raw
 * `stateService.listOwnedObjects` stub (rather than an ergonomic per-method wrapper) and so get
 * back v2's raw-bytes `nextPageToken` directly. Round-trips it into legacy's base64-string cursor,
 * and derives `hasNextPage` from that same re-encoded cursor rather than a second, independent
 * check against `nextPageToken` — so the two can't disagree and strand a caller looping on
 * `!hasNextPage`.
 */
export const toPageTokenResult = (nextPageToken: Uint8Array | undefined): PageTokenResult => {
    const nextCursor = nextPageToken ? toBase64(nextPageToken) : null;
    return { nextCursor, hasNextPage: nextCursor !== null };
};
