import { StrKey } from '@stellar/stellar-sdk';

import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { normalizeHex } from '@layerzerolabs/common-chain-model';
import {
    bytesToHexPrefixed,
    ensure0xPrefixed,
    hexToBytes,
    tileHex,
} from '@layerzerolabs/common-encoding-utils';

export type StellarStrKeyPrefix = 'C' | 'G';

const STELLAR_ADDRESS_BYTE_LENGTH = 32;
const CONTRACT_ID_HEX_LENGTH = 64;
const STRKEY_LENGTH = 56;

const stellarTextEncoder = new TextEncoder();
const stellarTextDecoder = new TextDecoder();

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
export const isValidStellarAddress = (address: string): boolean => {
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

/** Convert Stellar ASCII address to normalized hex by encoding the ASCII string as UTF-8 bytes. */
export const stellarAsciiToNormalized = (address: string): NormalizedHexString =>
    normalizeHex(bytesToHexPrefixed(stellarTextEncoder.encode(address)));

/** Convert normalized hex back to Stellar ASCII address by decoding UTF-8 bytes. */
export const normalizedToStellarAscii = (normalizedHex: NormalizedHexString): string => {
    // A StrKey address's first byte is always >= 0x42, so normalizeHex never strips a leading
    // nibble and the body stays even-length; hexToBytes rejects anything odd as malformed.
    return stellarTextDecoder.decode(hexToBytes(normalizedHex as unknown as HexString));
};

/** UTF-8 bytes of a Stellar ASCII address. */
export const stellarAddressToUtf8Bytes = (address: string): Uint8Array =>
    stellarTextEncoder.encode(address);

export const toStellarPayload = (hexAddress: string): Buffer => {
    const payload = Buffer.from(hexToBytes(ensure0xPrefixed(hexAddress)));
    if (payload.length !== STELLAR_ADDRESS_BYTE_LENGTH) {
        throw new Error(
            `Stellar address payload must be exactly ${STELLAR_ADDRESS_BYTE_LENGTH} bytes, got ${payload.length}`,
        );
    }
    return payload;
};

export const stellarAddressToHex = (stellarAddress: string): HexString => {
    if (StrKey.isValidEd25519PublicKey(stellarAddress)) {
        return bytesToHexPrefixed(StrKey.decodeEd25519PublicKey(stellarAddress));
    }
    if (StrKey.isValidContract(stellarAddress)) {
        return bytesToHexPrefixed(StrKey.decodeContract(stellarAddress));
    }
    if (StrKey.isValidLiquidityPool(stellarAddress)) {
        return bytesToHexPrefixed(StrKey.decodeLiquidityPool(stellarAddress));
    }
    if (StrKey.isValidClaimableBalance(stellarAddress)) {
        return bytesToHexPrefixed(StrKey.decodeClaimableBalance(stellarAddress).subarray(1));
    }
    if (StrKey.isValidMed25519PublicKey(stellarAddress)) {
        throw new Error('stellarAddressToHex is not supported for muxed addresses (M...)');
    }
    if (StrKey.isValidSignedPayload(stellarAddress)) {
        throw new Error('stellarAddressToHex is not supported for signed payload addresses (P...)');
    }
    throw new Error(`Unknown Stellar address type: ${stellarAddress}`);
};

export const stellarNormalizedToHex = (address: NormalizedHexString): HexString =>
    stellarAddressToHex(normalizedToStellarAscii(address));

/**
 * Converts a hex address back to a Stellar contract address (C...).
 *
 * Hex carries no address-type information, so the caller must know that the hex
 * originated from a 'C' address. If the hex came from a 'G' address, use
 * {@link hexToStellarAccountAddress}.
 *
 * @param hexOrStellarAddress - Hex string (with or without 0x prefix), or an already-native
 * Stellar address ('C...' or 'G...') which is passed through unchanged
 * @returns A 'C...' contract address for hex input, or the native 'C...'/'G...' address unchanged
 */
export const hexToStellarContractAddress = (hexOrStellarAddress: string): string => {
    if (!hexOrStellarAddress) {
        return StrKey.encodeContract(Buffer.alloc(STELLAR_ADDRESS_BYTE_LENGTH));
    }
    if (
        hexOrStellarAddress.length === STRKEY_LENGTH &&
        (StrKey.isValidContract(hexOrStellarAddress) ||
            StrKey.isValidEd25519PublicKey(hexOrStellarAddress))
    ) {
        return hexOrStellarAddress;
    }
    return StrKey.encodeContract(toStellarPayload(hexOrStellarAddress));
};

export const hexToStellarAccountAddress = (hexAddress: HexString): string =>
    StrKey.encodeEd25519PublicKey(toStellarPayload(hexAddress));

export const stellarContractHexToNormalized = (hexAddress: HexString): NormalizedHexString =>
    stellarAsciiToNormalized(StrKey.encodeContract(toStellarPayload(hexAddress)));

export const stellarAccountHexToNormalized = (hexAddress: HexString): NormalizedHexString =>
    stellarAsciiToNormalized(StrKey.encodeEd25519PublicKey(toStellarPayload(hexAddress)));

/** Deterministic Stellar contract sentinel for test fixtures. */
export const stellarSentinelNormalizedFromLabel = (label: string): NormalizedHexString => {
    const contractId = Buffer.from(hexToBytes(tileHex(label, CONTRACT_ID_HEX_LENGTH)));
    return stellarAsciiToNormalized(StrKey.encodeContract(contractId));
};
