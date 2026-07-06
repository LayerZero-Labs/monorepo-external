import { z } from 'zod';

import { oneSigLeafSchema } from './onesig-leaf';
import { oneSigBundleSizeOverrideSchema } from './onesig-overrides';
import { proposerSignatureSchema } from './onesig-proposer-signature';
import { signerSignatureSchema } from './onesig-signer-signature';

export const oneSigEntitySchema = z.object({
    id: z.uuid().describe('Client generated id for the batch of transactions'),
    oneSigName: z.string().describe('Canonical name of the OneSig'),
    expiry: z
        .number()
        .optional()
        .describe(
            'unix timestamp in milliseconds, after which the OneSig transactions fail to execute',
        ),

    seed: z.string().optional().describe('Seed for the OneSig'),
    signatures: z
        .array(signerSignatureSchema)
        .optional()
        .describe('List of signatures of the signers'),
    leaves: z.array(oneSigLeafSchema).describe('List of leaves'),
    metadata: z.record(z.any(), z.any()).optional().describe('Metadata for the OneSig'),
    bundlingOverride: oneSigBundleSizeOverrideSchema
        .optional()
        .describe('Override for the number of calls in a leaf'),
    proposerSignature: proposerSignatureSchema.describe(
        'Object containing the signature of the proposer and metadata',
    ),
});

export const oneSigProposedEntitySchema = z.object({
    status: z.string(),
    merkleRoot: z.string().optional(),
    expiry: z.number().optional(),
    seed: z.string().optional(),
    signatures: z.record(z.string(), z.string()),
});

export type OneSigEntity = z.infer<typeof oneSigEntitySchema>;
export type OneSigProposedEntity = z.infer<typeof oneSigProposedEntitySchema>;
