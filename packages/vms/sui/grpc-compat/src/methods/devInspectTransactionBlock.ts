import type { SuiClient } from '@mysten/sui/client';
import { GrpcTypes, type SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { Transaction } from '@mysten/sui-v2/transactions';

import { assertDefined, toTypeTagAddress } from '../utils';
import { withMoveAbortCode } from './helpers/moveAbortError';

export type DevInspectTransactionBlockGrpcClient = Pick<SuiGrpcClient, 'simulateTransaction'>;

/**
 * Drops every `DevInspectResults` field except `error` and `results[].returnValues` — the only
 * fields `suiMoveViewMultiResult` reads (packages/vms/sui/common/src/utils.ts).
 */
type V1DevInspectResults = Pick<
    Awaited<ReturnType<SuiClient['devInspectTransactionBlock']>>,
    'error' | 'results'
>;

export const devInspectTransactionBlock = async (
    grpcClient: DevInspectTransactionBlockGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<V1DevInspectResults> => {
    const [sender, kindBytes] = params as [string, string];

    // `sui_devInspectTransactionBlock` sends BCS-encoded `TransactionKind` (no gas data) built by
    // the caller's `Transaction.build({ onlyTransactionKind: true })`, with `sender` as a separate
    // param. `Transaction.fromKind` reconstructs the same builder so `simulateTransaction` can
    // resolve and submit it; `checksEnabled: false` mirrors devInspect's no-gas-charge semantics.
    const tx = Transaction.fromKind(kindBytes);
    tx.setSenderIfNotSet(sender);
    // The SDK's ergonomic commandResults retain bytes only. protoJson preserves each
    // executed output's BCS type name, including commands inserted for coin reservations.
    const simulated = await grpcClient.simulateTransaction({
        transaction: tx,
        checksEnabled: false,
        include: { commandResults: true, protoJson: true },
        signal,
    });

    const executed =
        simulated.$kind === 'Transaction' ? simulated.Transaction : simulated.FailedTransaction;
    if (!executed) {
        throw new Error(
            'Sui gRPC compat devInspectTransactionBlock: missing simulated transaction in gRPC response',
        );
    }

    const raw = GrpcTypes.SimulateTransactionResponse.fromJson(
        assertDefined(simulated.protoJson, 'devInspectTransactionBlock', 'protoJson'),
    );

    return {
        error: executed.status.success ? null : withMoveAbortCode(executed.status.error),
        results: raw.commandOutputs.map((command) => ({
            returnValues: command.returnValues.map((output): [number[], string] => [
                Array.from(
                    assertDefined(
                        output.value?.value,
                        'devInspectTransactionBlock',
                        'returnValue.value',
                    ),
                ),
                toTypeTagAddress(output.value?.name ?? '').replace(/,\s*/g, ', '),
            ]),
        })),
    };
};
