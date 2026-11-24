import {
    CANTON_CID_ADDRESS_PREFIX,
    CANTON_DEFERRED_VALUE_PREFIX,
    CANTON_DEFERRED_VALUE_SUFFIX,
    CANTON_OAPP_FILTER_DELIMITER,
    CANTON_PARTY_ADDRESS_PREFIX,
    type CantonAddress,
    cantonAddressToPartyId,
    cantonCidAddress,
    cantonGlobalAddress,
    cantonOAppFilterAddress,
    cantonPartyAddress,
    isCantonAddress,
    isCantonGlobalAddress,
    isCantonOAppFilterAddress,
    parseCantonDeferredValue,
    parseCantonGlobalAddress,
    parseCantonOAppFilterAddress,
} from '@layerzerolabs/common-canton/browser';
import type { HexString, NormalizedHexString } from '@layerzerolabs/common-chain-model';
import { isNormalizedHex, normalizeHex } from '@layerzerolabs/common-chain-model';
import {
    hexToBytes,
    hexToUtf8,
    tileHex,
    trim0x,
    utf8ToHex,
} from '@layerzerolabs/common-encoding-utils';
import type {
    CantonString,
    ChainName,
    ChainType,
    InferChainNamesForChainType,
} from '@layerzerolabs/layerzero-definitions';

import { addressParser } from './index';
import type { AddressParser, AddressSentinelNormalizedFromLabel } from './types';
import { AddressEncoding } from './types';

// --- Canton address encoding constants ---
const CANTON_FINGERPRINT_HEX_LENGTH = 68; // '1220' (4) + SHA-256 hex (64)
const CANTON_CONTRACT_ID_HEX_LENGTH = 138; // 69 bytes
const CANTON_TYPE_CONTRACT = '00';
const CANTON_TYPE_PARTY = '01';
const CANTON_TYPE_DEFERRED = '02';
// Internal representation only; bytes32 encoding strips this discriminator.
const CANTON_TYPE_GLOBAL = '03';
// utf8(`{partyId}|{id}`), the inner part of `<<CANTON_OAPP_FILTER::{partyId}|{id}>>`.
const CANTON_TYPE_OAPP_FILTER = '04';

// Internal sentinel-format parsers
const parsePartyAddress = (addr: CantonAddress): { hint: string; fingerprint: string } => {
    const inner = addr.slice(
        CANTON_PARTY_ADDRESS_PREFIX.length,
        -CANTON_DEFERRED_VALUE_SUFFIX.length,
    );
    const sep = inner.lastIndexOf('::');
    return { hint: inner.slice(0, sep), fingerprint: inner.slice(sep + 2) };
};

const parseCidAddress = (addr: CantonAddress): string =>
    addr.slice(CANTON_CID_ADDRESS_PREFIX.length, -CANTON_DEFERRED_VALUE_SUFFIX.length);

const deferredInner = (sentinel: string): string =>
    sentinel.slice(CANTON_DEFERRED_VALUE_PREFIX.length, -CANTON_DEFERRED_VALUE_SUFFIX.length);

export const encodeCantonRefAddress = (sentinel: string): NormalizedHexString =>
    normalizeHex(`0x${utf8ToHex(deferredInner(sentinel))}${CANTON_TYPE_DEFERRED}` as HexString);

export const decodeCantonRefAddress = (address: string): string | undefined => {
    const body = address.startsWith('0x') ? address.slice(2) : address;
    if (body.slice(-2) !== CANTON_TYPE_DEFERRED) return undefined;
    const inner = hexToUtf8(body.slice(0, -2));
    return `${CANTON_DEFERRED_VALUE_PREFIX}${inner}${CANTON_DEFERRED_VALUE_SUFFIX}`;
};

const oappFilterInner = (addr: CantonAddress): string => {
    const { partyId, id } = parseCantonOAppFilterAddress(addr);
    return `${partyId}${CANTON_OAPP_FILTER_DELIMITER}${id}`;
};

const encodeCantonOAppFilterAddress = (addr: CantonAddress): NormalizedHexString =>
    normalizeHex(`0x${utf8ToHex(oappFilterInner(addr))}${CANTON_TYPE_OAPP_FILTER}` as HexString);

const decodeCantonOAppFilterAddress = (hex: string): CantonAddress => {
    const inner = hexToUtf8(trim0x(hex).slice(0, -2));
    const delimiterIndex = inner.indexOf(CANTON_OAPP_FILTER_DELIMITER);
    try {
        const address = cantonOAppFilterAddress(
            inner.slice(0, delimiterIndex),
            inner.slice(delimiterIndex + CANTON_OAPP_FILTER_DELIMITER.length),
        );
        // Buffer hex decoding skips bad input, so only an exact round trip is a valid OApp filter.
        if (
            delimiterIndex >= 0 &&
            encodeCantonOAppFilterAddress(address) === normalizeHex(hex as HexString)
        ) {
            return address;
        }
    } catch {
        // Reported below.
    }
    throw new Error(`Malformed Canton OApp filter address: ${hex}`);
};

const globalAddressToBytes32 = (address: string): HexString => {
    if (!isCantonGlobalAddress(address)) {
        throw new Error('Canton bytes32 encoding requires an explicit global address');
    }
    return parseCantonGlobalAddress(address) as HexString;
};

const extractCantonAddress = (nativeAddress: string): string => {
    if (isCantonGlobalAddress(nativeAddress)) return globalAddressToBytes32(nativeAddress);
    if (nativeAddress.startsWith(CANTON_PARTY_ADDRESS_PREFIX)) {
        const { fingerprint, hint } = parsePartyAddress(nativeAddress as CantonAddress);
        return `0x${fingerprint}${utf8ToHex(hint)}`;
    }
    if (nativeAddress.startsWith(CANTON_CID_ADDRESS_PREFIX)) {
        const cid = parseCidAddress(nativeAddress as CantonAddress);
        return (cid.startsWith('0x') ? cid : `0x${cid}`).toLowerCase();
    }
    if (nativeAddress.startsWith(CANTON_DEFERRED_VALUE_PREFIX)) {
        return `0x${utf8ToHex(deferredInner(nativeAddress))}`;
    }
    if (isCantonOAppFilterAddress(nativeAddress)) {
        return `0x${utf8ToHex(oappFilterInner(nativeAddress))}`;
    }
    throw new Error(`Not a CantonAddress: ${nativeAddress}`);
};

const normalizeCantonAddress = (nativeAddress: string): NormalizedHexString => {
    if (isCantonGlobalAddress(nativeAddress)) {
        return normalizeHex(
            `${globalAddressToBytes32(nativeAddress)}${CANTON_TYPE_GLOBAL}` as HexString,
        );
    }
    if (nativeAddress.startsWith(CANTON_PARTY_ADDRESS_PREFIX)) {
        const { fingerprint, hint } = parsePartyAddress(nativeAddress as CantonAddress);
        return normalizeHex(`0x${fingerprint}${utf8ToHex(hint)}${CANTON_TYPE_PARTY}` as HexString);
    }
    if (nativeAddress.startsWith(CANTON_CID_ADDRESS_PREFIX)) {
        const cid = parseCidAddress(nativeAddress as CantonAddress);
        return normalizeHex(`0x${trim0x(cid)}${CANTON_TYPE_CONTRACT}` as HexString);
    }
    if (
        nativeAddress.startsWith(CANTON_DEFERRED_VALUE_PREFIX) &&
        nativeAddress.endsWith(CANTON_DEFERRED_VALUE_SUFFIX)
    ) {
        return encodeCantonRefAddress(nativeAddress);
    }
    if (isCantonOAppFilterAddress(nativeAddress)) {
        return encodeCantonOAppFilterAddress(nativeAddress);
    }
    throw new Error(`Not a CantonAddress: ${nativeAddress}`);
};

const reconstructCantonAddress = (hex: string): CantonAddress => {
    const body = trim0x(hex).padStart(2, '0');
    const typeByte = body.slice(-2);
    const payload = body.slice(0, -2);

    if (typeByte === CANTON_TYPE_GLOBAL) {
        return cantonGlobalAddress(`0x${payload.padStart(64, '0')}`);
    }
    if (typeByte === CANTON_TYPE_PARTY) {
        const fingerprint = payload.slice(0, CANTON_FINGERPRINT_HEX_LENGTH);
        const hintHex = payload.slice(CANTON_FINGERPRINT_HEX_LENGTH);
        return cantonPartyAddress(hexToUtf8(hintHex), fingerprint);
    }
    if (typeByte === CANTON_TYPE_CONTRACT) {
        return cantonCidAddress(payload.padStart(CANTON_CONTRACT_ID_HEX_LENGTH, '0'));
    }
    if (typeByte === CANTON_TYPE_DEFERRED) {
        return decodeCantonRefAddress(hex)! as CantonAddress;
    }
    if (typeByte === CANTON_TYPE_OAPP_FILTER) {
        return decodeCantonOAppFilterAddress(hex);
    }
    throw new Error(
        `Cannot reconstruct Canton address: unknown type discriminator '${typeByte}' in ${hex}`,
    );
};

const cantonAddressToParty = (addr: CantonAddress): string => {
    if (!addr.startsWith(CANTON_PARTY_ADDRESS_PREFIX)) {
        throw new Error(`Not a canton party address: ${addr}`);
    }
    const { hint, fingerprint } = parsePartyAddress(addr);
    return `${hint}::${fingerprint}`;
};

const cantonAddressToCid = (addr: CantonAddress): string => {
    if (!addr.startsWith(CANTON_CID_ADDRESS_PREFIX)) {
        throw new Error(`Not a canton contract ID address: ${addr}`);
    }
    return parseCidAddress(addr);
};

/**
 * Deterministic Canton party sentinel for test fixtures.
 * Leading-zero labels are rejected upstream in {@link sentinelNormalizedFromLabel}.
 */
// chainName unused — required by AddressSentinelNormalizedFromLabel; wired from sentinels.ts
export const cantonSentinelNormalizedFromLabel: AddressSentinelNormalizedFromLabel<
    typeof ChainName.CANTON
> = (_chainName, label) => {
    const fingerprint = `1220${trim0x(tileHex(label, 64))}`;
    return normalizeHex(`0x${fingerprint}${utf8ToHex(label)}${CANTON_TYPE_PARTY}` as HexString);
};

export const cantonNormalizedToBytes32Hex = (address: NormalizedHexString): HexString =>
    globalAddressToBytes32(reconstructCantonAddress(String(address)));

// As with Stellar's contract decoder, bytes32 decoding is for messaging identities.
// Party fingerprints require their own registry resolution, not this decoder.
export const cantonBytes32HexToNormalized = (bytes32Hex: HexString): NormalizedHexString =>
    normalizeCantonAddress(cantonGlobalAddress(bytes32Hex));

export const cantonAddressParser = (
    chainName: InferChainNamesForChainType<ChainType.CANTON>,
): AddressParser<InferChainNamesForChainType<ChainType.CANTON>> => {
    return {
        validateNative: (nativeAddress): nativeAddress is CantonString =>
            nativeAddress !== undefined && isCantonAddress(nativeAddress),
        normalizedToNative: (address) => {
            if (address === undefined) return undefined as any;
            return {
                nativeAddress: reconstructCantonAddress(String(address)) as unknown as CantonString,
                chainName,
            };
        },
        normalizedToNativeString: (address) => {
            if (address === undefined) return undefined as any;
            return reconstructCantonAddress(String(address)) as unknown as CantonString;
        },
        nativeToNormalized: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            return normalizeCantonAddress(nativeAddress as string);
        },
        nativeToBytes: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            const address = extractCantonAddress(nativeAddress as string) as HexString;
            return hexToBytes(address);
        },
        nativeToBytes32Hex: (address) => {
            if (address === undefined) return undefined as any;
            return globalAddressToBytes32(String(address));
        },
        nativeToBytes32: (address) => {
            if (address === undefined) return undefined as any;
            return hexToBytes(globalAddressToBytes32(String(address)));
        },
        normalizedToBytes32Hex: (address) => {
            if (address === undefined) return undefined as any;
            return cantonNormalizedToBytes32Hex(address);
        },
        normalizedToBytes32: (address) => {
            if (address === undefined) return undefined as any;
            return hexToBytes(cantonNormalizedToBytes32Hex(address));
        },
        bytes32ToNormalized: (bytes32Hex) => {
            if (bytes32Hex === undefined) return undefined as any;
            return cantonBytes32HexToNormalized(bytes32Hex);
        },
        parseNative: (nativeAddress) => {
            if (nativeAddress === undefined) return undefined as any;
            return normalizeCantonAddress(nativeAddress);
        },
        parseNativeToUnpaddedHex: (nativeAddress) => {
            return addressParser(chainName).parseNative(nativeAddress) as unknown as HexString;
        },
        normalizedToParty: (normalized) => {
            const addr = reconstructCantonAddress(String(normalized));
            return cantonAddressToParty(addr);
        },
        toLedgerParty: (address) =>
            isNormalizedHex(address)
                ? cantonAddressToParty(reconstructCantonAddress(address))
                : cantonAddressToPartyId(address),
        normalizedToCid: (normalized) => {
            const addr = reconstructCantonAddress(String(normalized));
            return cantonAddressToCid(addr);
        },
        normalizedToDeferredValue: (normalized) => {
            const addr = reconstructCantonAddress(String(normalized));
            const value = parseCantonDeferredValue(addr);
            if (!value) throw new Error(`Not a canton deferred ref address: ${String(normalized)}`);
            return value;
        },
        encoding: AddressEncoding.CANTON,
    };
};
