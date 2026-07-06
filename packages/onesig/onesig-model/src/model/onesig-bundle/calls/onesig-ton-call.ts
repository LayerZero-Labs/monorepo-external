import { z } from 'zod';

export const oneSigTONCallSchema = z.object({
    to: z.string(),
    value: z.string(),
    data: z.string(),
    metadata: z.record(z.any(), z.any()).optional().describe('Metadata for the call'),
    gasLimit: z.string().optional().describe('Gas limit for the transaction'),
});

export type OneSigTONCall = z.infer<typeof oneSigTONCallSchema>;
