import { z } from 'zod';

export const signerSignatureSchema = z.object({
    signature: z.string().describe('Signature of the signer'),
    metadata: z.record(z.any(), z.any()).optional().describe('Metadata for the signer'),
});

export type SignerSignature = z.infer<typeof signerSignatureSchema>;
