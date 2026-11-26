import { AccAddress } from '@initia/initia.js';

import type { HexString } from '@layerzerolabs/common-chain-model';
import { normalizeHex } from '@layerzerolabs/common-chain-model';
import {
    ensure0xPrefixed,
    hexToBytes,
    hexZeroPad,
    isHexString,
} from '@layerzerolabs/common-encoding-utils';
import type { ChainsByEncoding, InitiaString } from '@layerzerolabs/layerzero-definitions';

import { addressParser } from './index';
import type { AddressParser } from './types';
import { AddressEncoding } from './types';
import { assertNative, getAddress } from './utils';

export const initiaAddressParser: (
    chainName: ChainsByEncoding[InitiaString],
) => AddressParser<ChainsByEncoding[InitiaString]> = (chainName) => {
    return {
        validateNative: (nativeAddress): nativeAddress is InitiaString => {
            if (nativeAddress === undefined) {
                return false;
            }
            try {
                // Both formats are native for the chain and are used kind of randomly.
                return (
                    isHexString(nativeAddress) ||
                    /^(init)1(['qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38,66})$/.test(nativeAddress)
                );
            } catch {
                return false;
            }
        },
        normalizedToNative: (address) => {
            if (address === undefined) {
                return undefined as any;
            }
            return {
                nativeAddress: AccAddress.fromHex(address as unknown as HexString) as InitiaString,
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
            if (isHexString(address)) {
                // isHexString accepts unprefixed input, so add the 0x it may lack before normalizing.
                return normalizeHex(ensure0xPrefixed(address));
            }
            return normalizeHex(AccAddress.toHex(nativeAddress.toString()) as HexString);
        },
        nativeToBytes: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            return hexToBytes(
                hexZeroPad(
                    addressParser(chainName).nativeToNormalized(
                        nativeAddress,
                    ) as unknown as HexString,
                    32,
                ),
            );
        },
        parseNative: (nativeAddress) => {
            assertNative(nativeAddress, chainName);
            return addressParser(chainName).nativeToNormalized(nativeAddress);
        },
        parseNativeToUnpaddedHex: (nativeAddress) => {
            return addressParser(chainName).parseNative(nativeAddress) as unknown as HexString;
        },
        encoding: AddressEncoding.INITIA,
    };
};
