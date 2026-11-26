import type { HexString } from '@layerzerolabs/common-chain-model';
import { normalizeHex } from '@layerzerolabs/common-chain-model';
import { hexToBytes, hexZeroPad, isHexString } from '@layerzerolabs/common-encoding-utils';
import type { ChainsByEncoding } from '@layerzerolabs/layerzero-definitions';
import { ChainName } from '@layerzerolabs/layerzero-definitions';
import { StaticChainConfigs } from '@layerzerolabs/static-chain-info';

import { addressParser } from './index';
import type { AddressParser } from './types';
import { AddressEncoding } from './types';
import { assertNative, getAddress } from './utils';

export const hexAddressParser = (
    chainName: ChainsByEncoding[HexString],
): AddressParser<ChainsByEncoding[HexString]> => {
    return {
        validateNative: (nativeAddress): nativeAddress is HexString => {
            if (nativeAddress === undefined) return false;
            return isHexString(nativeAddress);
        },
        normalizedToNative: (address) => {
            if (address === undefined) return undefined as any;
            // we fetch here instead of storing by chain because some chains may not have this defined,
            // so we should only throw on those chains if they try to use these methods that need the native byte length
            const nativeByteLength = StaticChainConfigs.getAddressSizeInBytes(chainName);
            return {
                // we could have EIP-55 here, but omitted for now
                nativeAddress: hexZeroPad(address as unknown as HexString, nativeByteLength),
                chainName,
            };
        },
        normalizedToNativeString: (address) => {
            if (address === undefined) return undefined as any;
            const nativeByteLength = StaticChainConfigs.getAddressSizeInBytes(chainName);
            return hexZeroPad(address as unknown as HexString, nativeByteLength);
        },
        nativeToNormalized: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            return normalizeHex(address);
        },
        nativeToBytes: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            return hexToBytes(address);
        },
        parseNative: (nativeAddress) => {
            // Specific case to make tron a little less flaky, handle the 41 prefix
            if (chainName === ChainName.TRON && nativeAddress) {
                nativeAddress = nativeAddress.startsWith('41')
                    ? `0x${nativeAddress.slice(2)}`
                    : nativeAddress;
            }

            assertNative(nativeAddress, chainName);
            return addressParser(chainName).nativeToNormalized(nativeAddress);
        },
        parseNativeToUnpaddedHex: (nativeAddress) => {
            return addressParser(chainName).parseNative(nativeAddress) as unknown as HexString;
        },
        encoding: AddressEncoding.HEX,
    };
};
