import type { SuiClient } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { fromBase64 } from '@mysten/sui-v2/utils';

import { assertDefined } from '../utils';
import { withMoveAbortCode } from './helpers/moveAbortError';

export type DryRunTransactionBlockGrpcClient = Pick<SuiGrpcClient, 'simulateTransaction'>;

type V1DryRunTransactionBlockResponse = Awaited<ReturnType<SuiClient['dryRunTransactionBlock']>>;
type V1ExecutionStatus = V1DryRunTransactionBlockResponse['effects']['status'];
type V1GasUsed = V1DryRunTransactionBlockResponse['effects']['gasUsed'];

/**
 * Mysten 1.45 `Transaction.build()` → `setGasBudget` dry-runs to auto-size gas and reads
 * `effects.gasUsed.{computationCost,storageCost,storageRebate}`. Only those fields (plus
 * `status`) are mapped; `balanceChanges` / `objectChanges` / `events` / `input` /
 * `suggestedGasPrice` stay omitted until a real caller needs them.
 */
type MappedDryRunTransactionBlockResponse = {
    effects: {
        status: V1ExecutionStatus;
        gasUsed?: V1GasUsed;
    };
};

const METHOD = 'dryRunTransactionBlock';

const mapGasUsed = (gasUsed: {
    computationCost?: string | null;
    storageCost?: string | null;
    storageRebate?: string | null;
    nonRefundableStorageFee?: string | null;
}): V1GasUsed => ({
    computationCost: assertDefined(
        gasUsed.computationCost,
        METHOD,
        'effects.gasUsed.computationCost',
    ),
    storageCost: assertDefined(gasUsed.storageCost, METHOD, 'effects.gasUsed.storageCost'),
    storageRebate: assertDefined(gasUsed.storageRebate, METHOD, 'effects.gasUsed.storageRebate'),
    nonRefundableStorageFee: assertDefined(
        gasUsed.nonRefundableStorageFee,
        METHOD,
        'effects.gasUsed.nonRefundableStorageFee',
    ),
});

export const dryRunTransactionBlock = async (
    grpcClient: DryRunTransactionBlockGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<MappedDryRunTransactionBlockResponse> => {
    const [txBytes] = params as [string];

    // `sui_dryRunTransactionBlock` sends a fully built `TransactionData` (sender and gas payment
    // already resolved) as base64 bytes. Passing raw bytes skips `Transaction.prepareForSerialization`
    // (see @mysten/sui-v2's grpc/core.mjs) and forwards them as-is, matching a real dry run —
    // `checksEnabled` stays at its default (`true`), unlike devInspect's no-gas-charge simulation.
    // `include.effects` widens the default status-only read mask so gasUsed is present for Mysten's
    // auto gas budget path.
    const simulated = await grpcClient.simulateTransaction({
        transaction: fromBase64(txBytes),
        include: { effects: true },
        signal,
    });

    const executed =
        simulated.$kind === 'Transaction' ? simulated.Transaction : simulated.FailedTransaction;
    if (!executed) {
        throw new Error(
            'Sui gRPC compat dryRunTransactionBlock: missing simulated transaction in gRPC response',
        );
    }

    const success = executed.status.success;
    const status: V1ExecutionStatus = success
        ? { status: 'success' }
        : { status: 'failure', error: withMoveAbortCode(executed.status.error) };

    // Mysten only reads gasUsed after a successful dry run; skip mapping on failure so a missing
    // gasUsed on a failed sim doesn't mask the real execution error.
    if (!success) {
        return { effects: { status } };
    }

    return {
        effects: {
            status,
            gasUsed: mapGasUsed(
                assertDefined(executed.effects?.gasUsed, METHOD, 'effects.gasUsed'),
            ),
        },
    };
};
