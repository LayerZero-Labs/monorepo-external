import { z } from 'zod';

import { oneSigEVMCallSchema } from './onesig-evm-call';
import { oneSigSolanaCallSchema } from './onesig-solana-call';
import { oneSigStarknetCallSchema } from './onesig-starknet-call';
import { oneSigStellarCallSchema } from './onesig-stellar-call';
import { oneSigTONCallSchema } from './onesig-ton-call';

export const oneSigCallSchema = z.union([
    oneSigEVMCallSchema,
    oneSigSolanaCallSchema,
    oneSigStarknetCallSchema,
    oneSigStellarCallSchema,
    oneSigTONCallSchema,
]);

export type OneSigCall = z.infer<typeof oneSigCallSchema>;

export * from './onesig-evm-call';
export * from './onesig-solana-call';
export * from './onesig-starknet-call';
export * from './onesig-stellar-call';
export * from './onesig-ton-call';
