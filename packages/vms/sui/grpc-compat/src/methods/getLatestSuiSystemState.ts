import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

export type LatestSuiSystemStateGrpcClient = Pick<SuiGrpcClient, 'ledgerService'>;

/** Drops every `SuiSystemStateSummary` field except `epoch`, the only one any real caller reads. */
type V1LatestSuiSystemState = Pick<
    Awaited<ReturnType<SuiClient['getLatestSuiSystemState']>>,
    'epoch'
>;

export const getLatestSuiSystemState = async (
    grpcClient: LatestSuiSystemStateGrpcClient,
    _params: unknown[],
    signal?: AbortSignal,
): Promise<V1LatestSuiSystemState> => {
    // Omitting `epoch` resolves to the current epoch; default readMask covers this field.
    const { response } = await grpcClient.ledgerService.getEpoch({}, { abort: signal });

    if (response.epoch?.epoch === undefined) {
        throw new Error(
            'Sui gRPC compat getLatestSuiSystemState: missing epoch from gRPC response',
        );
    }

    return { epoch: response.epoch.epoch.toString() };
};
