import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

import { toShortStructTag } from '../utils';

export type GetAllBalancesGrpcClient = Pick<SuiGrpcClient, 'listBalances'>;

type V1AllBalances = Awaited<ReturnType<SuiClient['getAllBalances']>>;
type V1CoinBalance = V1AllBalances[number];

// Max page size the v2 state service accepts (values above 1000 are coerced down) — requesting
// it explicitly keeps the drain loop below to as few round trips as possible.
const PAGE_SIZE = 1000;

// A generous, deliberately-unreachable-by-any-real-wallet ceiling (500 * 1000 = 500,000
// balances) so a stuck pagination cursor (repeated page, or a gRPC server bug) fails loudly
// instead of looping forever — `options.timeout` is optional, so a caller that leaves it unset
// has nothing else to stop the loop.
const MAX_PAGES = 500;

/**
 * Legacy `suix_getAllBalances` returns every balance in one response (no pagination); the v2
 * `listBalances` is paginated, so this drains every page before returning.
 */
export const getAllBalances = async (
    grpcClient: GetAllBalancesGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1AllBalances> => {
    const [owner] = params as [string];

    const balances: V1CoinBalance[] = [];
    let cursor: string | null | undefined;
    let page = 0;

    do {
        if (page >= MAX_PAGES) {
            throw new Error(
                `Sui gRPC compat getAllBalances: exceeded ${MAX_PAGES} pages (${
                    MAX_PAGES * PAGE_SIZE
                } balances) for owner ${owner} — likely a stuck pagination cursor rather than a real wallet`,
            );
        }

        const response = await grpcClient.listBalances({
            owner,
            cursor,
            limit: PAGE_SIZE,
            signal,
        });

        for (const balance of response.balances) {
            balances.push({
                // See getBalance.ts: v2's fully-padded address form must be shortened to match
                // legacy's.
                coinType: toShortStructTag(balance.coinType),
                // See getBalance.ts: `balance` (address_balance + coin_balance) is the field
                // that matches legacy semantics, since legacy `totalBalance` combines both too.
                totalBalance: balance.balance,
                coinObjectCount: 0,
                lockedBalance: {},
            });
        }

        cursor = response.hasNextPage ? response.cursor : null;
        page += 1;
    } while (cursor);

    return balances;
};
