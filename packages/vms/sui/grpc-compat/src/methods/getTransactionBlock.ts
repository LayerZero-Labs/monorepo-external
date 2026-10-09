import type { SuiTransactionBlockResponseOptions } from '@mysten/sui/client';
import type { SuiGrpcClient } from '@mysten/sui-v2/grpc';

import { JSON_RPC, SuiCompatProviderSpecificError } from '../errors';
import {
    assertSupportedOptions,
    buildReadMask,
    buildTransactionBlockResult,
    type GrpcCompatTransactionBlock,
} from './helpers/transactionBlockResponse';

export type TransactionBlockGrpcClient = Pick<SuiGrpcClient, 'ledgerService'>;

const METHOD = 'getTransactionBlock';

export const getTransactionBlock = async (
    grpcClient: TransactionBlockGrpcClient,
    params: unknown[],
    signal?: AbortSignal,
): Promise<GrpcCompatTransactionBlock> => {
    const [digest, options] = params as [string, SuiTransactionBlockResponseOptions | undefined];

    assertSupportedOptions(options, METHOD);

    const { response } = await grpcClient.ledgerService.getTransaction(
        { digest, readMask: { paths: buildReadMask(options) } },
        { abort: signal },
    );

    const tx = response.transaction;
    if (!tx) {
        // This provider hasn't indexed the transaction (yet) — not a statement that it doesn't
        // exist. See `SuiCompatProviderSpecificError`.
        throw new SuiCompatProviderSpecificError(
            `Sui gRPC compat ${METHOD}: transaction not found for digest ${digest}`,
            JSON_RPC.CallExecutionFailed,
        );
    }
    // Not just "is a digest present" but "is it the one we asked for" — matches
    // `queryEventsByTransaction`'s identical guard. Without this, a semi-trusted/buggy gRPC
    // provider substituting the wrong transaction for a requested digest would have its effects/
    // events silently attributed to the digest the caller asked for.
    if (tx.digest !== digest) {
        throw new Error(
            `Sui gRPC compat ${METHOD}: response carried digest ${tx.digest ?? '<missing>'} for requested digest ${digest} — cannot confirm this response is for the right transaction`,
        );
    }

    return buildTransactionBlockResult(tx, digest, options, METHOD);
};
