import { z } from 'zod';

export const oneSigBundleSizeOverrideSchema = z
    .object({
        defaultBundleSize: z.number().describe('Default number of calls in a leaf'),
        chainSpecificBundleSize: z
            .record(z.string().or(z.number()), z.number().describe('chain specific bundle size'))
            .optional()
            .describe('Chain specific bundle size'),
    })
    .describe('Override for the number of calls in a leaf');

export type OneSigBundleSizeOverride = z.infer<typeof oneSigBundleSizeOverrideSchema>;
