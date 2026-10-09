import z from 'zod';

import { normalizedHexSchema } from './address';
import { transactionResultSchema, transactionSchema } from './transaction';

// Used by both onchain and offchain multisig
export const baseMultiSigDetailsSchema = z.object({
    proposerSenderEntityName: z.string(),
    multiSigAddress: normalizedHexSchema,
});

export const baseMultiSigTransactionToProposeSchema = transactionSchema.extend(
    baseMultiSigDetailsSchema.shape,
);

// Details that are used on onchain multisig and exist on sender entity
export const onchainMultiSigDetailsSchema = baseMultiSigDetailsSchema;

export const onchainMultiSigTransactionToProposeSchema = transactionSchema.extend({
    ...onchainMultiSigDetailsSchema.shape,
    nonce: z.number().optional(),
});

export const offChainMultiSigDetailsSchema = baseMultiSigDetailsSchema.extend({
    // TODO: support per-chain custom URLs with placeholders
    multiSigUrl: z.string(),
    // TODO: support sourcing API key from environment variable
    multiSigApiKey: z.string().optional(),
});

export const multiSigTransactionToProposeSchema = baseMultiSigTransactionToProposeSchema.extend({
    nonce: z.number(),
    ...offChainMultiSigDetailsSchema.shape,
});

export const multiSigSignedTransactionToProposeSchema = z.object({
    ...multiSigTransactionToProposeSchema.shape,
});

export const multiSigExecutedProposedTransactionSchema = z.object({
    ...multiSigTransactionToProposeSchema.shape,
    result: transactionResultSchema,
});

export type BaseMultiSigDetails = z.infer<typeof baseMultiSigDetailsSchema>;

export type OnchainMultiSigDetails = z.infer<typeof onchainMultiSigDetailsSchema>;
export type OnChainMultiSigTransactionToPropose = z.infer<
    typeof onchainMultiSigTransactionToProposeSchema
>;
export type OffchainMultiSigDetails = z.infer<typeof offChainMultiSigDetailsSchema>;
export type OnchainMultiSigTransactionToPropose = z.infer<
    typeof onchainMultiSigTransactionToProposeSchema
>;
export type MultiSigTransactionToPropose = z.infer<typeof multiSigTransactionToProposeSchema>;
export type MultiSigSignedTransactionToPropose = z.infer<
    typeof multiSigSignedTransactionToProposeSchema
>;
export type MultiSigExecutedProposedTransaction = z.infer<
    typeof multiSigExecutedProposedTransactionSchema
>;
