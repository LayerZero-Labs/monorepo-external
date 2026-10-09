import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { fromBase64 } from '@mysten/sui-v2/utils';

import { assertDefined, coinTypeFromObjectType } from '../utils';
import { resolvePageSize, toPageTokenResult } from './helpers/paginatedCoins';

export type GetAllCoinsGrpcClient = Pick<SuiGrpcClient, 'stateService'>;

type V1PaginatedCoins = Awaited<ReturnType<SuiClient['getAllCoins']>>;
type V1CoinStruct = V1PaginatedCoins['data'][number];

/**
 * A Move type with no type parameter matches every instantiation of it (per the v2
 * `ListOwnedObjectsRequest.object_type` proto docs), so this returns `Coin<T>` for every `T` —
 * the ergonomic `listCoins` wrapper can't do this, it always targets one `coinType` (defaulting
 * to SUI). No ergonomic wrapper exposes `balance` for a generic object listing either, so this
 * goes through the raw `stateService` stub with an explicit read mask, the same way
 * `GrpcCoreClient.listCoins` does internally for a single coin type.
 */
const ANY_COIN_TYPE = '0x2::coin::Coin';

export const getAllCoins = async (
    grpcClient: GetAllCoinsGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1PaginatedCoins> => {
    const [owner, cursor, limit] = params as [
        string,
        string | null | undefined,
        number | null | undefined,
    ];

    const { response } = await grpcClient.stateService.listOwnedObjects(
        {
            owner,
            objectType: ANY_COIN_TYPE,
            pageToken: cursor ? fromBase64(cursor) : undefined,
            pageSize: resolvePageSize(limit),
            readMask: { paths: ['object_id', 'version', 'digest', 'object_type', 'balance'] },
        },
        { abort: signal },
    );

    return {
        data: response.objects.map(
            (object): V1CoinStruct => ({
                coinObjectId: assertDefined(
                    object.objectId,
                    'getAllCoins',
                    'listOwnedObjects.objects[].objectId',
                ),
                // `object.objectType` is the wrapped Move object type (`0x2::coin::Coin<T>`,
                // since `ANY_COIN_TYPE` matches every instantiation). Unwrap the bare `T`
                // using the adapter's current rendering: shorten system addresses and keep
                // non-system addresses at full width. The captured legacy getCoins response
                // shortens non-system addresses too; cross-method alignment is separate.
                coinType: coinTypeFromObjectType(
                    assertDefined(
                        object.objectType,
                        'getAllCoins',
                        'listOwnedObjects.objects[].objectType',
                    ),
                ),
                balance: assertDefined(
                    object.balance,
                    'getAllCoins',
                    'listOwnedObjects.objects[].balance',
                ).toString(),
                digest: assertDefined(
                    object.digest,
                    'getAllCoins',
                    'listOwnedObjects.objects[].digest',
                ),
                version: assertDefined(
                    object.version,
                    'getAllCoins',
                    'listOwnedObjects.objects[].version',
                ).toString(),
                // See getCoins.ts: not requested by the read mask, and no real caller reads
                // it.
                previousTransaction: '',
            }),
        ),
        ...toPageTokenResult(response.nextPageToken),
    };
};
