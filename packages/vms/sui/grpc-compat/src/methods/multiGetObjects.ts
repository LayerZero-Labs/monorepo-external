import type { SuiObjectDataOptions, SuiObjectResponse } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

import { getReservationsByObjectIds, toReservationObjectData } from './helpers/coinReservations';
import { GRPC_CODE_NOT_FOUND } from './helpers/grpcStatus';
import { createDatatypeResolver } from './helpers/moveTypeLayout';
import { buildObjectReadMaskPaths, toV1ObjectData } from './helpers/objectData';

export type MultiGetObjectsGrpcClient = Pick<SuiGrpcClient, 'ledgerService' | 'movePackageService'>;

const METHOD = 'multiGetObjects';

// Legacy hard-rejects a call over this size ("Input exceeds limit of 50" — confirmed live
// against mainnet, both the rejection over 50 and success at exactly 50) rather than paging
// internally, so a shim that instead chunked and succeeded past it would accept requests legacy
// never would. Also matches the batch size Mysten's own SDK chunks `objectIds` into ahead of
// `batchGetObjects` (`@mysten/sui`'s `GrpcCoreClient.getObjects`, `src/grpc/core.ts`) — one
// `batchGetObjects` call is always enough once this cap holds.
const LEGACY_MAX_IDS = 50;

// Promise.all preserves input order, so the returned array stays aligned with `ids` — callers
// match responses to ids by position.
export const multiGetObjects = async (
    grpcClient: MultiGetObjectsGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<SuiObjectResponse[]> => {
    const [ids, options] = params as [string[], SuiObjectDataOptions | null | undefined];

    if (ids.length === 0) {
        return [];
    }

    if (ids.length > LEGACY_MAX_IDS) {
        throw new Error(`Sui gRPC compat ${METHOD}: Input exceeds limit of ${LEGACY_MAX_IDS}`);
    }

    const readMask = { paths: buildObjectReadMaskPaths(METHOD, options) };
    const resolveDatatype = createDatatypeResolver(grpcClient, signal);

    const { response } = await grpcClient.ledgerService.batchGetObjects(
        { requests: ids.map((objectId) => ({ objectId })), readMask },
        { abort: signal },
    );

    const missingIds: string[] = [];
    for (const [index, objectId] of ids.entries()) {
        const result = response.objects[index]?.result;
        if (result?.oneofKind === 'object') {
            continue;
        }
        const status = result?.oneofKind === 'error' ? result.error : undefined;
        if (status?.code !== GRPC_CODE_NOT_FOUND) {
            // Reject server/transport errors before attempting reservation reads. Only
            // NOT_FOUND can represent a synthetic reservation rather than an ordinary object.
            throw new Error(
                `Sui gRPC compat ${METHOD}: batchGetObjects failed for ${objectId} with code ${status?.code ?? 'unknown'}: ${status?.message ?? 'no result'}`,
            );
        }
        missingIds.push(objectId);
    }
    const reservations = await getReservationsByObjectIds(METHOD, grpcClient, missingIds, signal);

    return Promise.all(
        ids.map(async (objectId, index): Promise<SuiObjectResponse> => {
            const result = response.objects[index]?.result;
            if (result?.oneofKind === 'object') {
                return {
                    data: await toV1ObjectData(METHOD, result.object, options, resolveDatatype),
                };
            }

            const reservation = reservations.get(objectId);
            return reservation
                ? { data: toReservationObjectData(reservation, options) }
                : { error: { code: 'notExists', object_id: objectId } };
        }),
    );
};
