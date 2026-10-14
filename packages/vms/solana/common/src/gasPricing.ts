import { z } from 'zod';

export const solanaGasDataSchema = z.object({
    computeUnitPrice: z.number(),
});

export type SolanaGasData = z.infer<typeof solanaGasDataSchema>;
