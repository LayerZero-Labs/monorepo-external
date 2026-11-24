import { z } from 'zod';

import { decimalStringSchema } from '@layerzerolabs/common-chain-model';

export const evmLegacyGasDataSchema = z.object({
    type: z.literal('legacy'),
    gasPrice: decimalStringSchema,
});

export const evmEip1559GasDataSchema = z.object({
    type: z.literal('eip1559'),
    maxFeePerGas: decimalStringSchema,
    maxPriorityFeePerGas: decimalStringSchema,
    baseFeePerGas: decimalStringSchema,
});

export const evmGasDataSchema = z.discriminatedUnion('type', [
    evmLegacyGasDataSchema,
    evmEip1559GasDataSchema,
]);

export type EvmLegacyGasData = z.infer<typeof evmLegacyGasDataSchema>;
export type EvmEip1559GasData = z.infer<typeof evmEip1559GasDataSchema>;
export type EvmGasData = z.infer<typeof evmGasDataSchema>;
