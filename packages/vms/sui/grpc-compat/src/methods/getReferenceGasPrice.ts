import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

export type ReferenceGasPriceGrpcClient = Pick<SuiGrpcClient, 'getReferenceGasPrice'>;

type V1ReferenceGasPrice = Awaited<ReturnType<SuiClient['getReferenceGasPrice']>>;

/**
 * Mysten 1.45 `SuiClient.getReferenceGasPrice` returns a bigint after `BigInt(wire)`.
 * v2 gRPC still delivers the u64 as a decimal string, so we parse it here to match v1.
 */
export const getReferenceGasPrice = async (
    grpcClient: ReferenceGasPriceGrpcClient,
    _params: unknown[],
    signal?: AbortSignal,
): Promise<V1ReferenceGasPrice> => {
    const { referenceGasPrice } = await grpcClient.getReferenceGasPrice({ signal });

    if (typeof referenceGasPrice !== 'string' || referenceGasPrice === '') {
        throw new Error('Missing reference gas price from gRPC response');
    }

    return BigInt(referenceGasPrice);
};
