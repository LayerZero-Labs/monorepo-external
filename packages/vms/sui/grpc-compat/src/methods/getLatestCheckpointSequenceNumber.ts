import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

export type LatestCheckpointGrpcClient = Pick<SuiGrpcClient, 'ledgerService'>;

type V1LatestCheckpointSequenceNumber = Awaited<
    ReturnType<SuiClient['getLatestCheckpointSequenceNumber']>
>;

export const getLatestCheckpointSequenceNumber = async (
    grpcClient: LatestCheckpointGrpcClient,
    _params: unknown[],
    signal?: AbortSignal,
): Promise<V1LatestCheckpointSequenceNumber> => {
    const { response } = await grpcClient.ledgerService.getServiceInfo({}, { abort: signal });

    if (response.checkpointHeight === undefined) {
        throw new Error(
            'Sui gRPC compat getLatestCheckpointSequenceNumber: missing checkpointHeight from gRPC response',
        );
    }

    return response.checkpointHeight.toString();
};
