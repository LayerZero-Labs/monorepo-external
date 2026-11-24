import { StrKey } from '@stellar/stellar-sdk';

import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { normalizeHex } from '@layerzerolabs/common-chain-model';
import {
    bytesToHexPrefixed,
    hexToBytes,
    isHexString,
    tileHex,
} from '@layerzerolabs/common-encoding-utils';
import type {
    ChainName,
    ChainType,
    InferChainNamesForChainType,
    StellarString,
} from '@layerzerolabs/layerzero-definitions';

import { addressParser } from './index';
import type { AddressParser, AddressSentinelNormalizedFromLabel } from './types';
import { AddressEncoding } from './types';
import { assertNative, getAddress } from './utils';

const BYTES32_HEX_LENGTH = 64;

const stellarTextEncoder = new TextEncoder();

/** Convert Stellar ASCII address to normalized hex by encoding the ASCII string as UTF-8 bytes. */
const stellarAsciiToNormalized = (address: string): NormalizedHexString => {
    const bytes = stellarTextEncoder.encode(address);
    return normalizeHex(bytesToHexPrefixed(bytes));
};

const stellarNormalizedFromBytes32Hex = (bytes32Hex: HexString): NormalizedHexString =>
    stellarAsciiToNormalized(StrKey.encodeContract(Buffer.from(hexToBytes(bytes32Hex))));

/** Deterministic Stellar contract sentinel for test fixtures. */
// chainName unused — required by AddressSentinelNormalizedFromLabel; wired from sentinels.ts
export const stellarSentinelNormalizedFromLabel: AddressSentinelNormalizedFromLabel<
    typeof ChainName.STELLAR
> = (_chainName, label) => {
    return stellarNormalizedFromBytes32Hex(tileHex(label, BYTES32_HEX_LENGTH));
};

/**
 * If the input is a 0x-prefixed bytes32 hex string (raw contract ID),
 * convert it to native Stellar base32 format. Only accepts exactly
 * 32 bytes (64 hex chars) to avoid silent corruption from other hex
 * representations (e.g. the UTF-8 "normalized" encoding which is 56 bytes,
 * or a 20-byte EVM address).
 */
const hexToStellarNative = (address: string | undefined): string | undefined => {
    if (!address || !address.startsWith('0x') || !isHexString(address)) return address;
    const hexPayload = address.slice(2);
    if (hexPayload.length !== BYTES32_HEX_LENGTH) {
        throw new Error(
            `Stellar hex address must be exactly 32 bytes (${BYTES32_HEX_LENGTH} hex chars), got ${hexPayload.length}: ${address}`,
        );
    }
    const raw = Buffer.from(hexToBytes(hexPayload));
    return StrKey.encodeContract(raw);
};

export const stellarAddressParser: (
    chainName: InferChainNamesForChainType<ChainType.STELLAR>,
) => AddressParser<InferChainNamesForChainType<ChainType.STELLAR>> = (chainName) => {
    /**
     * Validate if a string is a valid Stellar address.
     *
     * According to SEP-0023 (https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md),
     * Stellar supports multiple address types encoded as base32 ASCII strings:
     * - Account addresses starting with 'G' (56 chars, Ed25519 public key)
     * - Contract addresses starting with 'C' (56 chars, contract ID)
     * - Muxed addresses starting with 'M' (69 chars, muxed account with ID)
     * - Liquidity pool addresses starting with 'L' (56 chars, pool ID)
     * - Claimable balance addresses starting with 'B' (56 chars, balance ID)
     * - Signed payload starting with 'P' (variable length)
     *
     * All addresses are stored in their native ASCII format to preserve type information.
     */
    const isValidStellarAddress = (address: string): boolean => {
        if (!address) return false;
        // Use the StrKey validation methods for all supported address types
        return (
            StrKey.isValidEd25519PublicKey(address) ||
            StrKey.isValidContract(address) ||
            StrKey.isValidMed25519PublicKey(address) ||
            StrKey.isValidLiquidityPool(address) ||
            StrKey.isValidClaimableBalance(address) ||
            StrKey.isValidSignedPayload(address)
        );
    };

    /**
     * Convert normalized hex back to Stellar ASCII address by decoding UTF-8 bytes.
     */
    const stellarTextDecoder = new TextDecoder();
    const normalizedToStellarAscii = (normalizedHex: NormalizedHexString): string => {
        // A StrKey address's first byte is always >= 0x42, so normalizeHex never strips a leading
        // nibble and the body stays even-length; hexToBytes rejects anything odd as malformed.
        const bytes = hexToBytes(normalizedHex as unknown as HexString);
        return stellarTextDecoder.decode(bytes);
    };

    return {
        validateNative: (nativeAddress): nativeAddress is StellarString => {
            if (nativeAddress === undefined) return false;
            return isValidStellarAddress(nativeAddress);
        },
        normalizedToNative: (address) => {
            if (address === undefined) return undefined as any;
            // Decode normalized hex back to ASCII Stellar address
            const stellarAddress = normalizedToStellarAscii(address);
            return {
                nativeAddress: stellarAddress as StellarString,
                chainName,
            };
        },
        normalizedToNativeString: (address) => {
            if (address === undefined) return undefined as any;
            return normalizedToStellarAscii(address) as StellarString;
        },
        nativeToNormalized: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            // Convert ASCII address to normalized hex
            return stellarAsciiToNormalized(address);
        },
        nativeToBytes32Hex: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            // Decode the Stellar address to its raw 32-byte payload based on type
            let rawBytes: Buffer;
            if (StrKey.isValidEd25519PublicKey(address)) {
                // Account addresses (G...) - Ed25519 public key (32 bytes)
                rawBytes = StrKey.decodeEd25519PublicKey(address);
            } else if (StrKey.isValidContract(address)) {
                // Contract addresses (C...) - contract ID (32 bytes)
                rawBytes = StrKey.decodeContract(address);
            } else if (StrKey.isValidLiquidityPool(address)) {
                // Liquidity pool addresses (L...) - pool ID (32 bytes)
                rawBytes = StrKey.decodeLiquidityPool(address);
            } else if (StrKey.isValidClaimableBalance(address)) {
                // Claimable balance addresses (B...) - balance ID (33 bytes: 1-byte version + 32-byte hash)
                // Per SEP-0023: first byte is the claimable balance type (0x00 = V0), followed by 32-byte SHA256 hash
                const fullBytes = StrKey.decodeClaimableBalance(address);
                rawBytes = fullBytes.subarray(1); // Skip the first byte (version), return the 32-byte hash
            } else if (StrKey.isValidMed25519PublicKey(address)) {
                // Muxed addresses (M...) contain additional data beyond 32 bytes
                throw new Error(
                    'nativeToBytes32 is not supported for Stellar muxed addresses (M...)',
                );
            } else if (StrKey.isValidSignedPayload(address)) {
                // Signed payload (P...) has variable length
                throw new Error(
                    'nativeToBytes32 is not supported for Stellar signed payload addresses (P...)',
                );
            } else {
                throw new Error(`Unknown Stellar address type: ${address}`);
            }
            return bytesToHexPrefixed(rawBytes);
        },
        nativeToBytes: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = getAddress(nativeAddress);
            assertNative(address, chainName);
            // Convert ASCII address to UTF-8 bytes
            return stellarTextEncoder.encode(address);
        },
        nativeToBytes32: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            // Use nativeToBytes32Hex and convert to Uint8Array
            const hex = addressParser(chainName).nativeToBytes32Hex(nativeAddress);
            return hexToBytes(hex);
        },
        normalizedToBytes32Hex: (address) => {
            if (address === undefined) return undefined as any;
            // Stellar normalized hex is UTF-8 of ASCII address (56 bytes), not raw bytes.
            // Route through native string to extract the raw 32-byte StrKey payload.
            return addressParser(chainName).nativeToBytes32Hex(
                addressParser(chainName).normalizedToNativeString(address),
            );
        },
        normalizedToBytes32: (address) => {
            if (address === undefined) return undefined as any;
            return hexToBytes(addressParser(chainName).normalizedToBytes32Hex(address));
        },
        bytes32ToNormalized: (bytes32Hex) => {
            if (bytes32Hex === undefined) return undefined as any;
            // Always assumes contract address type — G-address→bytes32 is a lossy upcast
            return stellarNormalizedFromBytes32Hex(bytes32Hex);
        },
        parseNative: (nativeAddress) => {
            nativeAddress = hexToStellarNative(nativeAddress);
            assertNative(nativeAddress, chainName);
            return addressParser(chainName).nativeToNormalized(nativeAddress);
        },
        parseNativeToUnpaddedHex: (nativeAddress) => {
            nativeAddress = hexToStellarNative(nativeAddress);
            assertNative(nativeAddress, chainName);
            const normalized = addressParser(chainName).nativeToNormalized(nativeAddress);
            return normalized as unknown as HexString;
        },
        encoding: AddressEncoding.STELLAR,
    };
};
