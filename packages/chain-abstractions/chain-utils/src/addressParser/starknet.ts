import type { HexString } from '@layerzerolabs/common-chain-model';
import { bigIntToHex, isHexString } from '@layerzerolabs/common-encoding-utils';
import type { ChainsByEncoding } from '@layerzerolabs/layerzero-definitions';

import { hexAddressParser } from './hex';
import { addressParser } from './index';
import type { AddressParser } from './types';
import { assertNative } from './utils';

// Starknet addresses do not handle hex-zero padding, so we just return the address as is
export const starknetAddressParser = (
    chainName: ChainsByEncoding[HexString],
): AddressParser<ChainsByEncoding[HexString]> => {
    return {
        ...hexAddressParser(chainName),
        validateNative: (nativeAddress): nativeAddress is HexString => {
            if (nativeAddress === undefined) return false;
            return isHexString(nativeAddress);
        },
        parseNative: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            // We can't trust starknet.js strings, they may actually be bigints!
            // so just convert everything to hex first, then convert to normalized
            nativeAddress = bigIntToHex(BigInt(nativeAddress));
            assertNative(nativeAddress, chainName);
            return addressParser(chainName).nativeToNormalized(nativeAddress);
        },
        normalizedToNative: (address) => {
            if (address === undefined) return undefined as any;
            return {
                nativeAddress: address,
                chainName,
            };
        },
        normalizedToNativeString: (address) => {
            if (address === undefined) return undefined as any;
            return address;
        },
    };
};
