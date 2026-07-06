import { z } from 'zod';

export const proposerSignatureSchema = z.object({
    signature: z.string().describe('Signature of the proposer'),
    signMerkleRoot: z.boolean().optional().default(false).describe('Sign the merkle root'),
    version: z.string().optional().describe('Algorithm used to generate the signature'),
    uniqueIdentifyingKeys: z
        .array(z.enum(['oneSigName', 'targetOneSigAddress', 'chainName', 'oneSigId']))
        .length(2)
        .optional()
        .describe('Keys used to uniquely identify the OneSig'),
});

export type ProposerSignature = z.infer<typeof proposerSignatureSchema>;
