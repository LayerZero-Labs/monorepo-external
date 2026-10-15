import { z } from 'zod';

import { oneSigCallSchema } from './calls';

export const oneSigLeafSchema = z.object({
    oneSigId: z.number().or(z.string()).describe('OneSig ID, this is EID of the chain'),
    targetOneSigAddress: z.string().describe('Address of the OneSig contract'),
    chainName: z.string().optional().describe('Name of the chain'),
    nonce: z.number().optional().describe('Nonce for the OneSig'),
    calls: z.array(oneSigCallSchema).describe('Calls to be made in the OneSig'),
    metadata: z.record(z.any(), z.any()).optional().describe('Metadata for the Leaf'),
    success: z
        .boolean()
        .optional()
        .describe(
            'Indicates whether the leaf has been successfully mined (true) or not (false), it will be undefined if not yet executed.',
        ),
    minedTransactionHash: z.string().optional().describe('Mined transaction hash'),
});

export enum OneSigTransactionStatus {
    PENDING = 'PENDING',
    EXECUTING = 'EXECUTING',
    EXECUTED = 'EXECUTED',
    SUCCESS = 'SUCCESS',
    FAILED = 'FAILED',
    NOT_EXECUTED = 'NOT_EXECUTED',
    UNKNOWN = 'UNKNOWN',
}

export const oneSigTransactionSchema = z.object({
    oneSigName: z.string(),
    bundleId: z.string(),
    chainName: z.string(),
    nonce: z.number(),
    minedTransactionHash: z.string().optional(),
    errorMessage: z.string().optional(),
    merkleProof: z.array(z.string()),
    status: z.enum(OneSigTransactionStatus),
    createdAt: z.number(),
    updatedAt: z.number(),
});

export const oneSigBundleTransactionsResponseSchema = z.object({
    transactions: z.array(oneSigTransactionSchema),
    nextToken: z.string().nullable(),
    bundleStatus: z.string(),
});

export type OneSigLeaf = z.infer<typeof oneSigLeafSchema>;
export type OneSigTransaction = z.infer<typeof oneSigTransactionSchema>;
export type OneSigBundleTransactionsResponse = z.infer<
    typeof oneSigBundleTransactionsResponseSchema
>;
