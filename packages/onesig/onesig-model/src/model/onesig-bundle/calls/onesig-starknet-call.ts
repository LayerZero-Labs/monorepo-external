import { z } from 'zod';

// Match the backend's Calldata validation exactly: plain string arrays pass,
// and arrays with starknet.js' __compiled__: true marker also pass.
// z.array().and(z.object()) intersections don't work in Zod, so we use z.custom.
const isCalldata = (value: unknown): value is string[] & { __compiled__?: true } =>
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string') &&
    ((value as { __compiled__?: unknown }).__compiled__ ?? true) === true;

const starknetCallDataSchema = z
    .custom<string[] & { __compiled__?: true }>(isCalldata)
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
