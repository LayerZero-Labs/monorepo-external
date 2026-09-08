import z from 'zod';

import { brandSchema } from '@layerzerolabs/zod-utils';

import { ChainKey, ChainName, ChainType, Environment, EnvironmentInstance } from './enums';

export const chainNameSchema = brandSchema(z.enum(ChainName), 'ChainNameSchema');

export const chainTypeSchema = brandSchema(z.enum(ChainType), 'ChainTypeSchema');

export const chainKeySchema = brandSchema(z.enum(ChainKey), 'ChainKeySchema');

export const environmentSchema = brandSchema(z.enum(Environment), 'EnvironmentSchema');

export const environmentInstanceSchema = brandSchema(
    z.enum(EnvironmentInstance),
    'EnvironmentInstanceSchema',
);

export const nativeAddressSchema = brandSchema(
    z.object({
        nativeAddress: z.string(),
        chainName: chainNameSchema,
    }),
    'NativeAddressSchema',
);

export type NativeAddress = z.infer<typeof nativeAddressSchema>;
