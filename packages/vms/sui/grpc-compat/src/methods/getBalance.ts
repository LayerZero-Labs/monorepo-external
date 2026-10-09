import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

import { toShortStructTag } from '../utils';

export type GetBalanceGrpcClient = Pick<SuiGrpcClient, 'getBalance'>;

type V1CoinBalance = Awaited<ReturnType<SuiClient['getBalance']>>;

/**
 * `rpc-sdk` `getNativeBalance` calls this directly (`provider.getBalance`), and
 * `SuiProvider.getCoinBalance` (the `rpc-activity-factory` chain adapter's path) calls it under
 * the hood too — both end up on the wire as `suix_getBalance`.
 */
export const getBalance = async (
    grpcClient: GetBalanceGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1CoinBalance> => {
    const [owner, coinType] = params as [string, string | null | undefined];

    const { balance } = await grpcClient.getBalance({
        owner,
        coinType: coinType ?? undefined,
        signal,
    });

    return {
        // v2 returns the fully-padded 32-byte address form (`0x000...02::sui::SUI`); legacy
        // returns the Move VM's short form (`0x2::sui::SUI`).
        coinType: toShortStructTag(balance.coinType),
        // `balance.balance` is `address_balance + coin_balance` (per the v2 proto field docs) —
        // this is what matches legacy semantics: since the unified-balance migration, legacy
        // `suix_getBalance`'s `totalBalance` also combines coin objects and address-balance
        // funds, not just `Coin<T>` objects. See
        // https://docs.sui.io/onchain-finance/asset-custody/address-balances/migrate-address-balances#json-rpc-legacy
        totalBalance: balance.balance,
        // The gRPC `Balance` message has no `Coin<T>` object count, and Sui's current staking
        // model leaves locked balances empty — no real caller in this repo reads either field
        // (rpc-sdk `getNativeBalance` only reads `totalBalance`).
        coinObjectCount: 0,
        lockedBalance: {},
    };
};
