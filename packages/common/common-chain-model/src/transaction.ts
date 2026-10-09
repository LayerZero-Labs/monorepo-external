import z from 'zod';

export const transactionMetadataTimestamps = z.object({
    created: z.number(),
    nonceAcquired: z.number().optional(),
    signed: z.number().optional(),
    sent: z.number().optional(),
    confirmed: z.number().optional(),
});

export const transactionSchema = z.object({
    properties: z.record(z.string(), z.any()).optional(),
    chainName: z.string(), //this is string because it's at a lower dependency level than lz-definitions
    timestamps: transactionMetadataTimestamps,
    type: z.string().optional(),
    parallelizingKey: z.string().optional(),
});

export const assignedTransactionSchema = transactionSchema.extend({
    senderEntityName: z.string(),
    nonce: z.number(),
});

export const transactionResultSchema = z.discriminatedUnion('type', [
    // transaction was submitted successfully
    z.object({
        type: z.literal('success'),
        minedTxHash: z.string(),
    }),
    // transaction was unable to be submitted
    z.object({
        type: z.literal('error'),
        error: z.string(),
    }),
    // we cannot know whether the transaction was submitted
    z.object({
        type: z.literal('indeterminate'),
        meta: z.any(),
    }),
]);

export const signedTransactionSchema = z.object({
    ...assignedTransactionSchema.shape,
});

export const minedTransactionSchema = z.object({
    ...assignedTransactionSchema.shape,
    result: transactionResultSchema,
});

export const transactionWithResultSchema = z.object({
    ...transactionSchema.shape,
    result: transactionResultSchema,
});

export const buildTransactionWithResultSchema = <T extends typeof transactionSchema>(
    txSchema: T,
) => {
    return z.object({
        ...txSchema.shape,
        result: transactionResultSchema,
    }) as z.ZodObject<T['shape'] & { result: typeof transactionResultSchema }, z.core.$strip>;
};

export interface Transaction extends z.infer<typeof transactionSchema> {}
export interface AssignedTransaction extends z.infer<typeof assignedTransactionSchema> {}
export interface SignedTransaction extends z.infer<typeof signedTransactionSchema> {}
export type TransactionResult = z.infer<typeof transactionResultSchema>;
export interface MinedTransaction extends z.infer<typeof minedTransactionSchema> {}
export interface TransactionWithResult extends z.infer<typeof transactionWithResultSchema> {}
export type TransactionWithResultFor<T extends Transaction> = T & {
    result: TransactionResult;
};
