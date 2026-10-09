import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

import { coinTypeFromObjectType } from '../utils';
import { getAddressBalanceReservation, toReservationCoin } from './helpers/coinReservations';
import { resolvePageSize } from './helpers/paginatedCoins';

export type GetCoinsGrpcClient = Pick<SuiGrpcClient, 'listCoins' | 'ledgerService'>;

const METHOD = 'getCoins';

// A one-item first page can contain only the reservation. Resume real coins from the start
// without emitting the reservation again. This marker cannot collide with a base64 gRPC token.
const COINS_START_CURSOR = 'sui-grpc-compat:coins-start';

type V1PaginatedCoins = Awaited<ReturnType<SuiClient['getCoins']>>;
type V1CoinStruct = V1PaginatedCoins['data'][number];

export const getCoins = async (
    grpcClient: GetCoinsGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1PaginatedCoins> => {
    const [owner, coinType, cursor, limit] = params as [
        string,
        string | null | undefined,
        string | null | undefined,
        number | null | undefined,
    ];

    // Put address funds on the first page: the transfer SDK stops selecting after 200 coins.
    // Appending a reservation after every real coin would strand funded wallets with many coins.
    const reservation = !cursor
        ? await getAddressBalanceReservation(
              METHOD,
              grpcClient,
              owner,
              coinType ?? '0x2::sui::SUI',
              signal,
          )
        : undefined;
    const pageSize = resolvePageSize(limit);
    const response = await grpcClient.listCoins({
        owner,
        coinType: coinType ?? undefined,
        cursor: cursor === COINS_START_CURSOR ? undefined : (cursor ?? undefined),
        // For limit=1, probe for a real coin so hasNextPage remains accurate. The marker above
        // re-reads that coin on the next request instead of dropping it or caching it locally.
        limit: reservation && pageSize > 1 ? pageSize - 1 : pageSize,
        signal,
    });

    const realCoins = response.objects.map(
        (coin): V1CoinStruct => ({
            coinObjectId: coin.objectId,
            coinType: coinTypeFromObjectType(coin.type),
            balance: coin.balance,
            digest: coin.digest,
            version: coin.version,
            // Not in the v2 `Coin` message (the ergonomic `listCoins` read mask doesn't
            // request it) — no real caller in this repo reads it, only `balance` /
            // `coinObjectId` (rpc-sdk, dexSwap).
            previousTransaction: '',
        }),
    );
    if (reservation && pageSize === 1) {
        const hasNextPage = realCoins.length > 0;
        return {
            data: [toReservationCoin(reservation)],
            hasNextPage,
            nextCursor: hasNextPage ? COINS_START_CURSOR : null,
        };
    }
    return {
        data: reservation ? [toReservationCoin(reservation), ...realCoins] : realCoins,
        hasNextPage: response.hasNextPage,
        nextCursor: response.cursor,
    };
};
