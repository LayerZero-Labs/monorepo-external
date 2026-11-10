import { AptosChain } from './chain-aptos';
import { CantonChain } from './chain-canton';
import { EvmChain } from './chain-evm';
import { InitiaChain } from './chain-initia';
import { IotaL1Chain } from './chain-iotal1';
import { SolanaChain } from './chain-solana';
import { StarknetChain } from './chain-starknet';
import { StellarChain } from './chain-stellar';
import { SuiChain } from './chain-sui';
import { TonChain } from './chain-ton';

export * from './chain-evm';
export * from './chain-solana';
export * from './chain-aptos';
export * from './chain-initia';
export * from './chain-ton';
export * from './chain-sui';
export * from './chain-iotal1';
export * from './chain-starknet';
export * from './chain-stellar';
export * from './chain-canton';

/**
 * Type representing a union of all supported chains.
 */
export type Chain =
    | EvmChain
    | AptosChain
    | SolanaChain
    | InitiaChain
    | TonChain
    | SuiChain
    | IotaL1Chain
    | StarknetChain
    | StellarChain
    | CantonChain;

/**
 * Object containing all supported chains.
 */
export const Chain = {
    ...EvmChain,
    ...AptosChain,
    ...SolanaChain,
    ...InitiaChain,
    ...TonChain,
    ...SuiChain,
    ...IotaL1Chain,
    ...StarknetChain,
    ...StellarChain,
    ...CantonChain,
};
