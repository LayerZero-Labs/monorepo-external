import { z } from 'zod';

export const oneSigStellarCallSchema = z.object({
    contractAddress: z.string().describe('Soroban contract address (C... StrKey format)'),
    functionName: z.string().describe('Name of the contract function to invoke'),
    args: z.array(z.string()).describe('XDR-encoded ScVal arguments (base64)'),
    metadata: z
        .record(z.any(), z.any())
        .optional()
        .describe('Metadata for the call, e.g. Human readable description of the call'),
});

export type OneSigStellarCall = z.infer<typeof oneSigStellarCallSchema>;
