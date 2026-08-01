import { z } from 'zod';

import { oneSigConfigSchema } from './onesig-config';

export * from './onesig-config';

/**
 * @deprecated Legacy `GET /onesigs` list response. Prefer
 * {@link listOneSigInstancesResponseSchema} (`GET /instances`).
 */
export const oneSigConfigApiResponseSchema = z.object({
    oneSigConfigs: z.array(oneSigConfigSchema),
});

/**
 * @deprecated Prefer {@link ListOneSigInstancesResponse}.
 */
export type OneSigConfigApiResponse = z.infer<typeof oneSigConfigApiResponseSchema>;
