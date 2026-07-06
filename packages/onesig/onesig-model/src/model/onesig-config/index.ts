import { z } from 'zod';

import { oneSigConfigSchema } from './onesig-config';

export * from './onesig-config';

export const oneSigConfigApiResponseSchema = z.object({
    oneSigConfigs: z.array(oneSigConfigSchema),
});

export type OneSigConfigApiResponse = z.infer<typeof oneSigConfigApiResponseSchema>;
