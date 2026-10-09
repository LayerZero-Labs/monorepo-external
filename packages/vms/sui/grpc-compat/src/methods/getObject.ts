import type { SuiObjectDataOptions, SuiObjectResponse } from '@mysten/sui/client';
import type { GrpcTypes, SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { RpcError } from '@protobuf-ts/runtime-rpc';

import { getReservationByObjectId, toReservationObjectData } from './helpers/coinReservations';
import { createDatatypeResolver } from './helpers/moveTypeLayout';
import { buildObjectReadMaskPaths, toV1ObjectData } from './helpers/objectData';

export type GetObjectGrpcClient = Pick<SuiGrpcClient, 'ledgerService' | 'movePackageService'>;

const METHOD = 'getObject';

export const getObject = async (
    grpcClient: GetObjectGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<SuiObjectResponse> => {
    const [id, options] = params as [string, SuiObjectDataOptions | null | undefined];

    let object: GrpcTypes.Object | undefined;
    try {
        const { response } = await grpcClient.ledgerService.getObject(
            { objectId: id, readMask: { paths: buildObjectReadMaskPaths(METHOD, options) } },
            { abort: signal },
        );
        object = response.object;
    } catch (error) {
        // Legacy never throws for a missing object — it returns {error: {code: 'notExists'}}.
        if (!(error instanceof RpcError && error.code === 'NOT_FOUND')) {
            throw error;
        }
    }

    if (!object) {
        const reservation = await getReservationByObjectId(METHOD, grpcClient, id, signal);
        if (reservation) {
            return { data: toReservationObjectData(reservation, options) };
        }
        return { error: { code: 'notExists', object_id: id } };
    }

    const resolveDatatype = createDatatypeResolver(grpcClient, signal);

    return { data: await toV1ObjectData(METHOD, object, options, resolveDatatype) };
};
