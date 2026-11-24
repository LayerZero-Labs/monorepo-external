import { Address } from '@ton/core';

import type { HexString } from '@layerzerolabs/common-chain-model';
import {
    base58ToBytes,
    bigIntToBytes,
    bytesToBigInt,
    bytesToHex,
    bytesToHexPrefixed,
    hexToBigInt,
    hexToBytes,
    isBase58,
    isHexString,
    trim0x,
} from '@layerzerolabs/common-encoding-utils';

export type AddressTypeLike = Address | string | bigint;

const to32ByteBuffer = (
    value: bigint | number | string | Uint8Array,
    maxIntermediateBufferSize = 66,
): Buffer => {
    if (typeof value === 'string') {
        if (!isHexString(value)) {
            throw new Error('only hex string is supported');
        }
        value = bytesToBigInt(hexToBytes(value));
    }
    if (value instanceof Uint8Array) {
        value = bytesToBigInt(value);
    }
    const bf = Buffer.from(bigIntToBytes(BigInt(value), maxIntermediateBufferSize));
    // trim from the left, keep the right 32 bytes
    return bf.subarray(-32);
};

export const bigintToAddress = (value: bigint): Address => {
    const buf = to32ByteBuffer(value);
    return Address.parse(`0:${bytesToHex(buf)}`);
};

export const parseTonAddress = (address: AddressTypeLike): Address => {
    if (address instanceof Address) {
        return address;
    }

    try {
        if (typeof address === 'bigint' || typeof address === 'number') {
            return bigintToAddress(BigInt(address));
        }

        // An empty body ('' or '0x') is not a valid TON address; the hex/bigint helpers below would
        // otherwise decode it to the zero address, so reject it explicitly.
        if (trim0x(address) === '') {
            throw new Error('cannot parse an empty string as a TON address');
        }

        if (address.startsWith('0x')) {
            // If it's a hex address format it to ton format
            return bigintToAddress(hexToBigInt(address));
        }

        try {
            return Address.parse(address);
        } catch {
            //at this point, our address is either hex without a '0x', or base58
            const _isBase58 = isBase58(address);
            const _isHex = isHexString(address);

            //this includes the case where the address is both base58 and hex
            //but nearly every address generated this way is hex (only 1/(~5.5e12) are b58)
            if (_isHex) {
                return bigintToAddress(hexToBigInt(address));
            }

            if (_isBase58) {
                return bigintToAddress(bytesToBigInt(base58ToBytes(address)));
            }

            //this is the case where the address is invalid in any encoding
            throw new Error(`The address ${address} cannot be decoded as TON, hex, or base58`);
        }
    } catch (err: any) {
        console.error('Error parsing address', {
            address,
            error: err?.message ?? err,
        });
        throw err;
    }
};

const _addressToNotPaddedHex = (address: AddressTypeLike) => {
    return bytesToHexPrefixed(parseTonAddress(address).hash);
};

export const addressToHex = (address: AddressTypeLike): HexString => {
    return bytesToHexPrefixed(to32ByteBuffer(_addressToNotPaddedHex(address)));
};

export const addressToBigInt = (address: AddressTypeLike) => {
    return BigInt(_addressToNotPaddedHex(address));
};

export const compareAddresses = (addressA: AddressTypeLike, addressB: AddressTypeLike) => {
    return parseTonAddress(addressA).equals(parseTonAddress(addressB));
};

/**
 * Since toString(2) does not include leading zeros, we can calculate the leading zeros by subtracting
 * the total length of address in binary from the total length of addresses in TON in bits (32 bytes * 8)
 */
export const numberOfLeadingZeroBitsInAddress = (address: AddressTypeLike) => {
    return 32 * 8 - addressToBigInt(address).toString(2).length;
};
