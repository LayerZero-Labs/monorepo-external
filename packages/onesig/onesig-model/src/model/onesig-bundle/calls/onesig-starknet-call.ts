import { z } from 'zod';

const starknetCallDataSchema = z
    .array(z.string())
    .and(
        z.object({
            __compiled__: z.literal(true).optional(),
        }),
    )
    .describe('Calldata for the transaction');

export const oneSigStarknetCallSchema = z.object({
    to: z.string(),
    selector: z.string(),
    calldata: starknetCallDataSchema,
    gasLimit: z
        .object({
            l1Gas: z.string().optional(),
            l2Gas: z.string().optional(),
            l1DataGas: z.string().optional(),
        })
        .optional()
        .describe('Gas limit for the transaction'),
    metadata: z
        .record(z.any(), z.any())
        .optional()
        .describe(`Metadata for the call, e.g. human-readable description of the call`),
});

export type OneSigStarknetCall = z.infer<typeof oneSigStarknetCallSchema>;
