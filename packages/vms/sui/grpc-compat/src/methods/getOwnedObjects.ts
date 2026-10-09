import type {
    PaginatedObjectsResponse,
    SuiObjectDataFilter,
    SuiObjectResponse,
    SuiObjectResponseQuery,
} from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { fromBase64 } from '@mysten/sui-v2/utils';

import { createDatatypeResolver } from './helpers/moveTypeLayout';
import { buildObjectReadMaskPaths, toV1ObjectData } from './helpers/objectData';
import { resolvePageSize, toPageTokenResult } from './helpers/paginatedCoins';

export type GetOwnedObjectsGrpcClient = Pick<SuiGrpcClient, 'stateService' | 'movePackageService'>;

const METHOD = 'getOwnedObjects';

// v2 only supports a single Move-type filter; { StructType } is the only shape any caller passes.
const toObjectTypeFilter = (filter: SuiObjectDataFilter | null | undefined): string | undefined => {
    if (!filter) {
        return undefined;
    }

    if ('StructType' in filter && typeof filter.StructType === 'string') {
        return filter.StructType;
    }

    throw new Error(
        `Sui gRPC compat ${METHOD}: ${JSON.stringify(filter)} is not yet supported — no production caller requests any filter shape besides { StructType }`,
    );
};

export const getOwnedObjects = async (
    grpcClient: GetOwnedObjectsGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<PaginatedObjectsResponse> => {
    const [owner, query, cursor, limit] = params as [
        string,
        SuiObjectResponseQuery | null | undefined,
        string | null | undefined,
        number | null | undefined,
    ];
    const options = query?.options;

    const { response } = await grpcClient.stateService.listOwnedObjects(
        {
            owner,
            objectType: toObjectTypeFilter(query?.filter),
            pageToken: cursor ? fromBase64(cursor) : undefined,
            pageSize: resolvePageSize(limit),
            readMask: { paths: buildObjectReadMaskPaths(METHOD, options) },
        },
        { abort: signal },
    );

    const resolveDatatype = createDatatypeResolver(grpcClient, signal);
    const data = await Promise.all(
        response.objects.map(
            async (object): Promise<SuiObjectResponse> => ({
                data: await toV1ObjectData(METHOD, object, options, resolveDatatype),
            }),
        ),
    );

    return { data, ...toPageTokenResult(response.nextPageToken) };
};
