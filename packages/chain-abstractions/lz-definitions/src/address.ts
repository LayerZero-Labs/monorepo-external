import type { Branded, HexString } from '@layerzerolabs/typescript-utils';

import type { ChainName } from './enums';
import type { ChainType, InferChainTypeForChainName } from './enums';

export type Base58String = Branded<string, 'Base58String'>;
export type TonString = Branded<string, 'TonString'>;
export type InitiaString = Branded<string, 'InitiaString'>;
export type StellarString = Branded<string, 'StellarString'>;
export type CantonString = Branded<string, 'CantonString'>;

export type EncodingType =
    | Base58String
    | HexString
    | TonString
    | InitiaString
    | StellarString
    | CantonString;

export type EncodingByChainType = {
    [ChainType.APTOSMOVE]: HexString;
    [ChainType.EVM]: HexString;
    [ChainType.SOLANA]: Base58String;
    [ChainType.STARKNET]: HexString;
    [ChainType.SUIMOVE]: HexString;
    [ChainType.TON]: HexString;
    [ChainType.STELLAR]: StellarString;
    [ChainType.CANTON]: CantonString;
};

// Overrides for chain in a chainType that have different address encodings
export type EncodingByChainNameOverrides = {
    // Empty for now
    initia: InitiaString;
};

// Resolves the encoding string ("hex" | "base58" | "ton") for a given ChainName
export type ResolvedEncodingForChainName<T extends ChainName> =
    T extends keyof EncodingByChainNameOverrides
        ? EncodingByChainNameOverrides[T]
        : InferChainTypeForChainName<T> extends keyof EncodingByChainType
          ? EncodingByChainType[InferChainTypeForChainName<T>]
          : never;

export type ChainNativeAddress<T extends ChainName> = {
    nativeAddress: ResolvedEncodingForChainName<T>;
    chainName: T;
};

// Builds an object type like { hex: union-of-hex-chains, base58: union-of-base58-chains, ton: ..., tron: ... }
export type ChainsByEncoding = {
    [E in EncodingType]: {
        [_ChainName in ChainName]: ResolvedEncodingForChainName<_ChainName> extends E
            ? _ChainName
            : never;
    }[ChainName];
};
