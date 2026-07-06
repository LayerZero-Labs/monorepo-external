import { z } from 'zod';

export const oneSigEVMCallSchema = z.object({
    to: z
        .string()
        .trim()
        .regex(/^0x[a-fA-F0-9]{40}$/),
    value: z.string(),
    data: z.string(),
    gasLimit: z.string().optional().describe('Gas limit for the transaction'),
    metadata: z
        .record(z.any(), z.any())
        .optional()
        .describe(`Metadata for the call, e.g. human-readable description of the call`),
});

export type OneSigEVMCall = z.infer<typeof oneSigEVMCallSchema>;
