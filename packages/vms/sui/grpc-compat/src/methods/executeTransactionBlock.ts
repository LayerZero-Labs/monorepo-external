import type { SuiTransactionBlockResponseOptions } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';
import { TransactionDataBuilder } from '@mysten/sui-v2/transactions';
import { fromBase64 } from '@mysten/sui-v2/utils';

import {
    assertSupportedOptions,
    buildReadMask,
    buildTransactionBlockResult,
    type GrpcCompatTransactionBlock,
} from './helpers/transactionBlockResponse';

export type ExecuteTransactionBlockGrpcClient = Pick<SuiGrpcClient, 'transactionExecutionService'>;

const METHOD = 'executeTransactionBlock';

/**
 * Broadcasts an already-signed transaction. `transaction-sdk`'s `sendTransaction` (every VM's
 * wallet send step) calls this with no `options` — the response is otherwise only read for
 * `digest`/`events`/`checkpoint` (see `SuiMoveProvider.executeSuiMoveTransactionBlock`), and
 * `assertTransactionMined` never trusts this response for mined status either — it separately
 * polls `getTransactionBlock` by digest (see `transaction-activity-factory/impls/suiMove.ts`).
 *
 * Validates `options` BEFORE broadcasting: once `executeTransaction` is called the transaction
 * may already be committed on-chain, so a validation error thrown afterwards would look like a
 * failed send to a caller that retries on any exception, risking a duplicate submission.
 */
export const executeTransactionBlock = async (
    grpcClient: ExecuteTransactionBlockGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<GrpcCompatTransactionBlock> => {
    const [transactionBlock, signatures, options] = params as [
        string,
        string[],
        SuiTransactionBlockResponseOptions | undefined,
    ];

    assertSupportedOptions(options, METHOD);

    const transactionBytes = fromBase64(transactionBlock);
    // The transaction digest is a deterministic hash of the signed bytes themselves — the same
    // `TransactionDataBuilder.getDigestFromBytes` that `Transaction.getDigest()` uses, which is
    // how the rest of the codebase already derives it locally (see `suiMove.ts`'s `sign`, which
    // computes `txHash` this way *before* ever calling execute). Computing it here, before the
    // broadcast, means the digest never depends on the execute response being well-formed: a
    // response that's missing or unreadable still leaves us with the one fact that matters to the
    // only real caller (`sendTransaction`, which reads nothing but `digest`/`events`/`checkpoint`
    // and otherwise defers to `assertTransactionMined`'s own digest-based polling for confirmation).
    const digest = TransactionDataBuilder.getDigestFromBytes(transactionBytes);

    const { response } = await grpcClient.transactionExecutionService.executeTransaction(
        {
            transaction: { bcs: { value: transactionBytes } },
            signatures: signatures.map((signature) => ({
                bcs: { value: fromBase64(signature) },
                signature: { oneofKind: undefined },
            })),
            readMask: { paths: buildReadMask(options) },
        },
        { abort: signal },
    );

    const tx = response.transaction;

    // A response that carries a *different* digest than what we broadcast means a misbehaving or
    // byzantine gRPC endpoint attributed someone else's execution to this call — a caller trusting
    // `effects.status`/`events` off of that would think the wrong transaction succeeded or failed.
    // Loud failure here, matching `queryEventsByTransaction`'s identical guard for the read path.
    // `buildReadMask` always requests `digest`, so an absent one fails this check too.
    if (tx && tx.digest !== digest) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: response carried digest ${tx.digest ?? '<missing>'} for a broadcast whose digest is ${digest} — cannot confirm this response is for the right transaction`,
        );
    }

    // The RPC call itself didn't throw (broadcast was accepted), but the server sent back no
    // `ExecutedTransaction` at all — only possible from a malformed/incomplete response, since a
    // genuine on-chain execution failure still comes back as a `tx` with `effects.status.success
    // === false` (see `buildEffects`), not an absent `tx`. Only fail loudly here if fields that
    // require the response were actually requested; the real caller requests none of them and
    // already has everything it needs in `digest`.
    if (!tx) {
        if (
            options?.showInput ||
            options?.showEffects ||
            options?.showEvents ||
            options?.showObjectChanges
        ) {
            throw new Error(
                `Sui gRPC compat ${METHOD}: response carried no transaction data for broadcast digest ${digest} — cannot honor the requested options`,
            );
        }
        return { digest, checkpoint: null, timestampMs: null };
    }

    return buildTransactionBlockResult(tx, digest, options, METHOD);
};
