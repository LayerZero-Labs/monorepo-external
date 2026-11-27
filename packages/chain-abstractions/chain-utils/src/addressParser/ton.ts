import { Address } from '@ton/core';

import { addressToHex, bigintToAddress } from '@layerzerolabs/address-utils-ton';
import type { HexString } from '@layerzerolabs/common-chain-model';
import { normalizeHex } from '@layerzerolabs/common-chain-model';
import { hexToBytes, hexZeroPad } from '@layerzerolabs/common-encoding-utils';
import type {
    ChainType,
    InferChainNamesForChainType,
    TonString,
} from '@layerzerolabs/layerzero-definitions';

import { addressParser } from './index';
import type { AddressParser } from './types';
import { AddressEncoding } from './types';
import { assertNative, getAddress } from './utils';

export const tonAddressParser: (
    chainName: InferChainNamesForChainType<ChainType.TON>,
) => AddressParser<InferChainNamesForChainType<ChainType.TON>> = (chainName) => {
    return {
        validateNative: (nativeAddress): nativeAddress is TonString => {
            if (nativeAddress === undefined) {
                return false;
            }
            try {
                Address.parse(nativeAddress);
                return true;
            } catch {
                return false;
            }
        },
        normalizedToNative: (address) => {
            if (address === undefined) return undefined as any;
            const numericalValue = addressParser.normalizedToBigInt(address);
            return {
                nativeAddress: bigintToAddress(numericalValue).toString() as TonString,
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
            return normalizeHex(addressToHex(address));
        },
        nativeToBytes32Hex: (nativeAddress) => {
            // naturally ton is 32 bytes, pad it anyway
            if (nativeAddress === undefined) return undefined as any;
            return hexZeroPad(
                addressParser(chainName).nativeToNormalized(nativeAddress) as unknown as HexString,
                32,
            );
        },
        nativeToBytes: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            return hexToBytes(addressParser(chainName).nativeToBytes32Hex(nativeAddress));
        },
        nativeToBytes32: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            return hexToBytes(addressParser(chainName).nativeToBytes32Hex(nativeAddress));
        },
        normalizedToBytes32Hex: (address) => {
            if (address === undefined) return undefined as any;
            return hexZeroPad(address as unknown as HexString, 32);
        },
        normalizedToBytes32: (address) => {
            if (address === undefined) return undefined as any;
            return hexToBytes(addressParser(chainName).normalizedToBytes32Hex(address));
        },
        bytes32ToNormalized: (bytes32Hex) => {
            if (bytes32Hex === undefined) return undefined as any;
            return normalizeHex(bytes32Hex);
        },
        parseNative: (nativeAddress) => {
            assertNative(nativeAddress, chainName);
            return addressParser(chainName).nativeToNormalized(nativeAddress);
        },
        parseNativeToUnpaddedHex: (nativeAddress) => {
            return addressParser(chainName).parseNative(nativeAddress) as unknown as HexString;
        },
        tonToNormalized: (tonAddress) => {
            return normalizeHex(addressToHex(tonAddress));
        },
        encoding: AddressEncoding.TON,
    };
};
