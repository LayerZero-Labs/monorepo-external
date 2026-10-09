import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

import { JSON_RPC, SuiCompatProviderSpecificError } from '../errors';
import { timestampToMs } from '../utils';

export type CheckpointGrpcClient = Pick<SuiGrpcClient, 'ledgerService'>;

/**
 * Deliberately drops `epoch`, `previousDigest`, `transactions`, `networkTotalTransactions`,
 * `epochRollingGasCostSummary`, `checkpointCommitments`, `endOfEpochData`, and
 * `validatorSignature` — no real caller (rpc-sdk's getBlock/getBlockTimestamp/
 * getBlockFromTxHash, lz-v2-sdk's refreshLZEvent, the rpc-activity-factory chain adapter) reads
 * them. If a future caller needs one, add it here and to the gRPC `readMask` below.
 */
type V1Checkpoint = Pick<
    Awaited<ReturnType<SuiClient['getCheckpoint']>>,
    'digest' | 'sequenceNumber' | 'timestampMs'
>;

const parseSequenceNumber = (id: string): bigint => {
    if (!/^\d+$/.test(id)) {
        throw new Error(
            `Sui gRPC compat getCheckpoint: only sequence-number lookups are supported, received ${JSON.stringify(id)} — no production caller passes a checkpoint digest`,
        );
    }
    return BigInt(id);
};

export const getCheckpoint = async (
    grpcClient: CheckpointGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1Checkpoint> => {
    const [id] = params as [string];

    const { response } = await grpcClient.ledgerService.getCheckpoint(
        {
            checkpointId: { oneofKind: 'sequenceNumber', sequenceNumber: parseSequenceNumber(id) },
            readMask: { paths: ['sequence_number', 'digest', 'summary.timestamp'] },
        },
        { abort: signal },
    );

    const checkpoint = response.checkpoint;
    if (
        !checkpoint?.digest ||
        checkpoint.sequenceNumber === undefined ||
        !checkpoint.summary?.timestamp
    ) {
        // This provider hasn't indexed the checkpoint (yet) — not a statement that it doesn't
        // exist. See SuiCompatProviderSpecificError.
        throw new SuiCompatProviderSpecificError(
            `Sui gRPC compat getCheckpoint: checkpoint not found for sequence number ${id}`,
            JSON_RPC.CallExecutionFailed,
        );
    }

    return {
        digest: checkpoint.digest,
        sequenceNumber: checkpoint.sequenceNumber.toString(),
        timestampMs: timestampToMs(checkpoint.summary.timestamp),
    };
};
