import type { Address } from '@ton/core';

import type { CantonDeferredValue } from '@layerzerolabs/common-canton/browser';
import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import type {
    ChainName,
    ChainNativeAddress,
    InferChainTypeForChainName,
    ResolvedEncodingForChainName,
} from '@layerzerolabs/layerzero-definitions';
import type { MaybeUndefinedMapped } from '@layerzerolabs/typescript-utils';

export type NativeOrString<T extends ChainName> =
    | ChainNativeAddress<T>
    | ResolvedEncodingForChainName<T>;

export enum AddressEncoding {
    HEX = 'hex',
    BASE58 = 'base58',
    TON = 'ton',
    INITIA = 'initia',
    STELLAR = 'stellar',
    CANTON = 'canton',
}

export type ExtensionByChainType = {
    ton: {
        tonToNormalized: (tonAddress: Address) => NormalizedHexString;
    };
    canton: {
        /** Decode a normalized canton address to the raw party string (`hint::fingerprint`). Throws if not a party address. */
        normalizedToParty: (normalized: NormalizedHexString) => string;
        /** Decode a normalized, `<<CANTON_PARTY::…>>` or raw party address to the raw party string the ledger accepts. Throws if not a party address. */
        toLedgerParty: (address: string) => string;
        /** Decode a normalized canton address to the raw contract ID string. Throws if not a CID address. */
        normalizedToCid: (normalized: NormalizedHexString) => string;
        /** Decode a normalized canton address to the parsed deferred-value object. Throws if not a deferred ref address. */
        normalizedToDeferredValue: (normalized: NormalizedHexString) => CantonDeferredValue;
    };
};

export type InferExtensionByChainName<T extends ChainName> =
    InferChainTypeForChainName<T> extends keyof ExtensionByChainType
        ? ExtensionByChainType[InferChainTypeForChainName<T>]
        : {};

export type AddressParser<T extends ChainName> = {
    normalizedToNative: <Address extends NormalizedHexString | undefined>(
        address: Address,
    ) => MaybeUndefinedMapped<Address, ChainNativeAddress<T>>;
    normalizedToNativeString: <Address extends NormalizedHexString | undefined>(
        address: Address,
    ) => MaybeUndefinedMapped<Address, ResolvedEncodingForChainName<T>>;
    nativeToNormalized: <Address extends NativeOrString<T> | undefined>(
        nativeAddress: Address,
    ) => MaybeUndefinedMapped<Address, NormalizedHexString>;
    nativeToBytes: <Address extends NativeOrString<T> | undefined>(
        nativeAddress: Address,
    ) => MaybeUndefinedMapped<Address, Uint8Array>;
    validateNative: (
        nativeAddress: string | undefined,
    ) => nativeAddress is ResolvedEncodingForChainName<T>;
    /**
     * Parse a native address to a string if it is valid.
     * Throws an error if the native address is invalid.
     * On Stellar this is StrKey-only.
     * @param nativeAddress - The native address to parse.
     * @returns The parsed native address.
     */
    parseNative: (nativeAddress: string | undefined) => NormalizedHexString;
    parseNativeToUnpaddedHex: (nativeAddress: string | undefined) => HexString;
    encoding: AddressEncoding;
} & InferExtensionByChainName<T>;

/** Internal routing hook for sentinel label → normalized hex; not part of the public API. */
export type AddressSentinelNormalizedFromLabel<T extends ChainName> = (
    chainName: T,
    label: string,
) => NormalizedHexString;
