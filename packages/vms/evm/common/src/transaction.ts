import { z } from 'zod';

import {
    assignedTransactionSchema,
    decimalStringSchema,
    hexSchema,
    minedTransactionSchema,
    normalizedHexSchema,
    signedTransactionSchema,
    transactionSchema,
} from '@layerzerolabs/common-chain-model';
import type { ChainType, InferChainNamesForChainType } from '@layerzerolabs/layerzero-definitions';
import { isZkChain } from '@layerzerolabs/static-chain-info';
import type { DecimalString, PartialBy } from '@layerzerolabs/typescript-utils';

import { ZKSYNC_DEPLOYMENT_TRANSACTION_TYPE } from './constants';
import { evmGasDataSchema } from './gasPricing';

// === Component schemas ===

const _rawEvmUnsignedPopulatedTransactionSchema = {
    to: normalizedHexSchema.optional(),
    value: decimalStringSchema.optional(),
    gas: decimalStringSchema,
    data: z.string().optional(),
};

const _rawEvmFullPopulatedTransactionSchema = {
    ..._rawEvmUnsignedPopulatedTransactionSchema,
    // Sender address is populated only during transaction signing
    from: normalizedHexSchema,
};

const _rawZkPopulatedTransactionSchema = {
    ..._rawEvmUnsignedPopulatedTransactionSchema,
    factoryDeps: z.array(hexSchema).optional(),
    data: hexSchema.optional(),
};

const _evmUnsignedPopulatedTransactionSchema = z.object(_rawEvmUnsignedPopulatedTransactionSchema);
const _evmFullPopulatedTransactionSchema = z.object(_rawEvmFullPopulatedTransactionSchema);
const _zkPopulatedTransactionSchema = z.object(_rawZkPopulatedTransactionSchema);

const _evmInflightTransactionSchema = z.object({
    txHash: z.string(),
    signedTransaction: z.string(),
    gasData: evmGasDataSchema,
});

// === Lifecycle schemas ===

export const evmTransactionSchema = transactionSchema.extend({
    populatedTransaction: _evmUnsignedPopulatedTransactionSchema,
});

export const evmAssignedTransactionSchema = assignedTransactionSchema.extend({
    ...evmTransactionSchema.shape,
    inflightTransactions: z.array(_evmInflightTransactionSchema).optional(),
});

export const evmSignedTransactionSchema = signedTransactionSchema.extend({
    ...evmAssignedTransactionSchema.shape,
    // TODO: change this to evmFullPopulatedTransactionSchema when implementing Tron Transaction Activities
    populatedTransaction: _evmUnsignedPopulatedTransactionSchema,
});

export const evmMinedTransactionSchema = minedTransactionSchema.extend({
    ...evmSignedTransactionSchema.shape,
});

// === zkSync variant schemas ===
// zkSync only overrides the transaction and assigned stages; the signed and mined
// stages reuse the EVM schemas above.

export const zkTransactionSchema = transactionSchema.extend({
    populatedTransaction: _zkPopulatedTransactionSchema,
});

export const zkAssignedTransactionSchema = assignedTransactionSchema.extend({
    ...zkTransactionSchema.shape,
    inflightTransactions: z.array(_evmInflightTransactionSchema).optional(),
});

// === Types ===

export type EvmTransaction = z.infer<typeof evmTransactionSchema>;
export type EvmPopulatedTransaction = EvmTransaction['populatedTransaction'];
export type EvmSignedTransaction = z.infer<typeof evmSignedTransactionSchema>;
export type EvmMinedTransaction = z.infer<typeof evmMinedTransactionSchema>;

export type EvmUnsignedPopulatedTransaction = z.infer<
    typeof _evmUnsignedPopulatedTransactionSchema
>;
export type EvmFullPopulatedTransaction = z.infer<typeof _evmFullPopulatedTransactionSchema>;
export type EvmInflightTransaction = z.infer<typeof _evmInflightTransactionSchema>;

export type ZkTransaction = z.infer<typeof zkTransactionSchema>;
export type ZkPopulatedTransaction = z.infer<typeof _zkPopulatedTransactionSchema>;

// === Builder ===

export type BuildEvmTransactionInput = PartialBy<EvmTransaction, 'chainName' | 'timestamps'> & {
    populatedTransaction: EvmTransaction['populatedTransaction'] &
        Partial<Pick<ZkPopulatedTransaction, 'factoryDeps'>>;
};

export const buildEvmTransaction = async (
    chainName: string,
    tx: BuildEvmTransactionInput,
): Promise<EvmTransaction> => {
    const { factoryDeps, ...populatedTransaction } = tx.populatedTransaction;

    // TODO: `isZkChain` uses `ChainName` which is LZ-specific, as it comes from `layerzero-definitions`.
    // `common-evm` should not be dependent on `layerzero-definitions`.
    const isZk = isZkChain(chainName as InferChainNamesForChainType<ChainType.EVM>);
    const hasFactoryDeps = factoryDeps != null && factoryDeps.length > 0;

    return {
        ...tx,
        chainName,
        timestamps: {
            created: tx.timestamps?.created ?? Date.now(),
        },
        populatedTransaction: {
            ...populatedTransaction,
            ...(isZk && hasFactoryDeps ? { factoryDeps } : {}),
        },
        type: tx.type ?? (isZk && hasFactoryDeps ? ZKSYNC_DEPLOYMENT_TRANSACTION_TYPE : undefined),
    };
};

// === TODO: move into appropriate files ===

// Viem contract-call overrides — belong with `viemUtils.ts` (their only consumer), not the
// transaction data model.
export type EvmTransactionOverrides = {
    gas?: DecimalString;
};

export type EvmTransactionPayableOverrides = EvmTransactionOverrides & {
    value?: DecimalString;
};
