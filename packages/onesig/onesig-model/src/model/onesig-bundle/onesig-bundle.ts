import z from 'zod';

import { oneSigBundleMetadataSchema } from './onesig-metadata';

export const oneSigBundleStatusSchema = z.enum([
    'created',
    'bundling',
    'validating',
    'waiting_signatures',
    'executing',
    'executed',
    'executed_with_failures',
    'failed',
    'failed_validation',
    'cancelled',
]);

export type OneSigBundleStatus = z.infer<typeof oneSigBundleStatusSchema>;

export const oneSigBundleSchema = z.object({
    oneSigName: z.string().optional(),
    id: z.string().optional(), // id and bundleId are the same. bundleId is for backwards compatibility.
    bundleId: z.string().optional(),
    creationDate: z.number().optional(),
    activeStatus: z.boolean().optional(),
    status: oneSigBundleStatusSchema.optional(),
    threshold: z.number().optional(),
    signers: z.array(z.string()).optional(),
    proposers: z.array(z.string()).optional(),
    proposerSignature: z.string().optional(),
    proposerAddress: z.string().optional(),
    merkleRoot: z.string().optional(),
    expiry: z.number().optional(),
    seed: z.string().optional(),
    signatures: z.record(z.string(), z.string()).optional(),
    witnessSignatures: z.record(z.string(), z.string()).optional(),
    message: z.string().optional(),
    metadata: oneSigBundleMetadataSchema
        .optional()
        .describe(
            'Bundle metadata as submitted by the proposer. Flat, closed key set: Description (string), configName (string). Rejected at upload when larger than 100KB.',
        ),
});

export type OneSigBundle = z.infer<typeof oneSigBundleSchema>;
