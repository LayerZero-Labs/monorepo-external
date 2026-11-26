import type { HexString } from '@layerzerolabs/common-chain-model';
import { normalizeHex } from '@layerzerolabs/common-chain-model';
import {
    base58ToBytes,
    bytesToBase58,
    bytesToHexPrefixed,
    hexToBytes,
    hexZeroPad,
    isBase58,
} from '@layerzerolabs/common-encoding-utils';
import type { Base58String, ChainsByEncoding } from '@layerzerolabs/layerzero-definitions';
import { StaticChainConfigs } from '@layerzerolabs/static-chain-info';

import { addressParser } from './index';
import type { AddressParser } from './types';
import { AddressEncoding } from './types';
import { assertNative, getAddress } from './utils';

export const base58AddressParser = (
    chainName: ChainsByEncoding[Base58String],
): AddressParser<ChainsByEncoding[Base58String]> => {
    return {
        validateNative: (nativeAddress): nativeAddress is Base58String => {
            if (nativeAddress === undefined) return false;
            return isBase58(nativeAddress);
        },
        normalizedToNative: (address) => {
            if (address === undefined) return undefined as any;
            const nativeByteLength = StaticChainConfigs.getAddressSizeInBytes(chainName);
            return {
                nativeAddress: bytesToBase58(
                    hexToBytes(hexZeroPad(address as unknown as HexString, nativeByteLength)),
                ) as Base58String,
                chainName,
            };
        },
        normalizedToNativeString: (address) => {
            if (address === undefined) return undefined as any;
            return addressParser(chainName).normalizedToNative(address).nativeAddress;
        },
        nativeToNormalized: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            const hex = bytesToHexPrefixed(base58ToBytes(address));
            return normalizeHex(hex);
        },
        nativeToBytes: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            return base58ToBytes(address);
        },
        parseNative: (nativeAddress) => {
            assertNative(nativeAddress, chainName);
            return addressParser(chainName).nativeToNormalized(nativeAddress);
        },
        parseNativeToUnpaddedHex: (nativeAddress) => {
            return addressParser(chainName).parseNative(nativeAddress) as unknown as HexString;
        },
        encoding: AddressEncoding.BASE58,
    };
};
