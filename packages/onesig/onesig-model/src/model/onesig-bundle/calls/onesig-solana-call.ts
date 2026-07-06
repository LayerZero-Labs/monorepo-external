import { z } from 'zod';

const solanaAccountMetaSchema = z.object({
    pubkey: z.string(),
    isSigner: z.boolean(),
    isWritable: z.boolean(),
});

export const oneSigSolanaCallSchema = z.object({
    programId: z.string().describe('The Solana program ID to call'),
    keys: z.array(solanaAccountMetaSchema).describe('Account keys for the instruction'),
    data: z.string().describe('Hex-encoded instruction data'),
    value: z.string().describe('SOL amount in lamports'),
    computeUnitLimit: z.string().optional().describe('Max allowed compute units for the call'),
    metadata: z
        .record(z.any(), z.any())
        .optional()
        .describe('Metadata for the call, e.g. Human readable description of the call'),
});

export type OneSigSolanaCall = z.infer<typeof oneSigSolanaCallSchema>;
