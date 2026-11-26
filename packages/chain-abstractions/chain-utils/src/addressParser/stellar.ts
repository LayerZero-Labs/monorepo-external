import {
    isValidStellarAddress,
    normalizedToStellarAscii,
    stellarAddressToUtf8Bytes,
    stellarAsciiToNormalized,
} from '@layerzerolabs/address-utils-stellar';
import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import type {
    ChainType,
    InferChainNamesForChainType,
    StellarString,
} from '@layerzerolabs/layerzero-definitions';

import { addressParser } from './index';
import type { AddressParser } from './types';
import { AddressEncoding } from './types';
import { assertNative, getAddress } from './utils';

export const stellarAddressParser: (
    chainName: InferChainNamesForChainType<ChainType.STELLAR>,
) => AddressParser<InferChainNamesForChainType<ChainType.STELLAR>> = (chainName) => {
    const normalizedToValidStellarAddress = (normalizedHex: NormalizedHexString): StellarString => {
        const stellarAddress = normalizedToStellarAscii(normalizedHex);
        assertNative(stellarAddress, chainName);
        return stellarAddress;
    };

    return {
        validateNative: (nativeAddress): nativeAddress is StellarString => {
            if (nativeAddress === undefined) return false;
            return isValidStellarAddress(nativeAddress);
        },
        normalizedToNative: (address) => {
            if (address === undefined) return undefined as any;
            return {
                nativeAddress: normalizedToValidStellarAddress(address),
                chainName,
            };
        },
        normalizedToNativeString: (address) => {
            if (address === undefined) return undefined as any;
            return normalizedToValidStellarAddress(address);
        },
        nativeToNormalized: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            // Convert ASCII address to normalized hex
            return stellarAsciiToNormalized(address);
        },
        nativeToBytes: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            // Convert ASCII address to UTF-8 bytes
            return stellarAddressToUtf8Bytes(address);
        },
        parseNative: (nativeAddress) => {
            assertNative(nativeAddress, chainName);
            return addressParser(chainName).nativeToNormalized(nativeAddress);
        },
        parseNativeToUnpaddedHex: (nativeAddress) => {
            assertNative(nativeAddress, chainName);
            const normalized = addressParser(chainName).nativeToNormalized(nativeAddress);
            return normalized as unknown as HexString;
        },
        encoding: AddressEncoding.STELLAR,
    };
};
