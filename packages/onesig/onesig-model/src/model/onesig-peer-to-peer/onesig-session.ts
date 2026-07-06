import { z } from 'zod';

export const oneSigSessionSchema = z.object({
    expiry: z.number(),
    signature: z.string(),
});

export type OneSigSession = z.infer<typeof oneSigSessionSchema>;
