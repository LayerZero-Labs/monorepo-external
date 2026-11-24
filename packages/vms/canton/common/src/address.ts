import { hexZeroPad, trim0x } from '@layerzerolabs/common-encoding-utils';
import type { Branded } from '@layerzerolabs/typescript-utils';

import {
    CANTON_DEFERRED_VALUE_PREFIX,
    CANTON_DEFERRED_VALUE_SUFFIX,
    isCantonDeferredSentinel,
} from './deferredValue';

const CANTON_PARTY_ID_REGEX = /^(.+)::([0-9a-fA-F]+)$/;
const CANTON_CONTRACT_ID_HEX_LENGTH = 138; // 69 bytes

export const CANTON_PARTY_ADDRESS_PREFIX = '<<CANTON_PARTY::';
export const CANTON_CID_ADDRESS_PREFIX = '<<CANTON_CID::';
export const CANTON_GLOBAL_ADDRESS_PREFIX = '<<CANTON_GLOBAL::';
export const CANTON_OAPP_FILTER_ADDRESS_PREFIX = '<<CANTON_OAPP_FILTER::';
export const CANTON_OAPP_FILTER_DELIMITER = '|';

const CANTON_OAPP_FILTER_ADDRESS_REGEX =
    /^<<CANTON_OAPP_FILTER::([^|<>]+::[0-9a-fA-F]+)\|([^|]+)>>$/;

/** A Canton ledger or VER global address, with an explicit sentinel prefix. */
export type CantonAddress = Branded<string, 'CantonAddress'>;

/** Construct a party `CantonAddress` from hint and fingerprint. */
export const cantonPartyAddress = (hint: string, fingerprint: string): CantonAddress =>
    `${CANTON_PARTY_ADDRESS_PREFIX}${hint}::${fingerprint}${CANTON_DEFERRED_VALUE_SUFFIX}` as CantonAddress;

/** Construct a contract-ID `CantonAddress` from the raw 69-byte hex contract id. */
export const cantonCidAddress = (contractId: string): CantonAddress =>
    `${CANTON_CID_ADDRESS_PREFIX}${contractId}${CANTON_DEFERRED_VALUE_SUFFIX}` as CantonAddress;

/** Explicitly wrap an already-derived VER global address. This does not hash the input. */
export const cantonGlobalAddress = (address: string): CantonAddress => {
    if (!/^(?:0x)?[0-9a-fA-F]{1,64}$/.test(address)) {
        throw new Error(`Invalid Canton global bytes32 address: ${address}`);
    }
    return `${CANTON_GLOBAL_ADDRESS_PREFIX}${hexZeroPad(address, 32).toLowerCase()}${CANTON_DEFERRED_VALUE_SUFFIX}` as CantonAddress;
};

export const isCantonGlobalAddress = (value: string): value is CantonAddress =>
    /^<<CANTON_GLOBAL::0x[0-9a-fA-F]{64}>>$/.test(value);

/**
 * The global address sentinel for a raw VER global bytes32. A value that is already a global
 * address sentinel is returned unchanged.
 *
 * @throws Error for a value that is neither a global address sentinel nor 1 to 64 hex characters.
 */
export const toCantonGlobalAddress = (address: string): CantonAddress =>
    isCantonGlobalAddress(address) ? address : cantonGlobalAddress(address);

/**
 * The lowercase `0x{bytes32}` inside a global address (`<<CANTON_GLOBAL::0x{bytes32}>>`). This is the
 * inverse of {@link cantonGlobalAddress}.
 *
 * @throws Error for any other input.
 */
export const parseCantonGlobalAddress = (address: string): string => {
    if (!isCantonGlobalAddress(address)) {
        throw new Error(`Not a Canton global address: ${address}`);
    }
    return address
        .slice(CANTON_GLOBAL_ADDRESS_PREFIX.length, -CANTON_DEFERRED_VALUE_SUFFIX.length)
        .toLowerCase();
};

/** Returns true for an OApp filter address: `<<CANTON_OAPP_FILTER::{hint}::{hex fingerprint}|{id}>>`. */
export const isCantonOAppFilterAddress = (value: string): value is CantonAddress =>
    CANTON_OAPP_FILTER_ADDRESS_REGEX.test(value);

/**
 * Construct an OApp filter `CantonAddress` (`<<CANTON_OAPP_FILTER::{partyId}|{id}>>`) from the OApp's party
 * id (`hint::fingerprint`) and its id.
 *
 * @throws Error if `partyId` is not a party id, or `id` is empty or contains `|`.
 */
export const cantonOAppFilterAddress = (partyId: string, id: string): CantonAddress => {
    if (id.includes(CANTON_OAPP_FILTER_DELIMITER)) {
        throw new Error(
            `Canton OApp filter id must not contain '${CANTON_OAPP_FILTER_DELIMITER}': ${id}`,
        );
    }
    const address = `${CANTON_OAPP_FILTER_ADDRESS_PREFIX}${partyId}${CANTON_OAPP_FILTER_DELIMITER}${id}${CANTON_DEFERRED_VALUE_SUFFIX}`;
    if (!isCantonOAppFilterAddress(address)) {
        throw new Error(`Invalid Canton OApp filter: partyId=${partyId} id=${id}`);
    }
    return address as CantonAddress;
};

/**
 * Split an OApp filter address (`<<CANTON_OAPP_FILTER::{partyId}|{id}>>`) into its party id and id. This is
 * the inverse of {@link cantonOAppFilterAddress}.
 *
 * @throws Error for any other input.
 */
export const parseCantonOAppFilterAddress = (address: string): { partyId: string; id: string } => {
    const match = CANTON_OAPP_FILTER_ADDRESS_REGEX.exec(address);
    if (!match) {
        throw new Error(`Not a Canton OApp filter address: ${address}`);
    }
    return { partyId: match[1]!, id: match[2]! };
};

/** Wrap a deferred-ref sentinel (`<<CANTON_DEFERRED:{json}>>`) as a `CantonAddress`. */
export const cantonDeferredAddress = (sentinel: string): CantonAddress => sentinel as CantonAddress;

/** Wrap a raw Canton ledger value (party id, contract id, or deferred sentinel) as `CantonAddress`. */
export const toCantonAddress = (raw: string): CantonAddress => {
    if (isCantonDeferredSentinel(raw)) {
        return cantonDeferredAddress(raw);
    }
    const partyMatch = CANTON_PARTY_ID_REGEX.exec(raw);
    if (partyMatch) {
        const [, hint, fingerprint] = partyMatch;
        return cantonPartyAddress(hint!, fingerprint!);
    }
    const bare = trim0x(raw);
    if (bare.length === CANTON_CONTRACT_ID_HEX_LENGTH && bare.startsWith('00')) {
        return cantonCidAddress(bare);
    }
    throw new Error(`Not a Canton-native address: ${raw}`);
};

/** Returns true if `value` is a valid `CantonAddress` sentinel string. */
export const isCantonAddress = (value: string): value is CantonAddress =>
    value.startsWith(CANTON_PARTY_ADDRESS_PREFIX) ||
    value.startsWith(CANTON_CID_ADDRESS_PREFIX) ||
    isCantonDeferredSentinel(value) ||
    isCantonGlobalAddress(value) ||
    isCantonOAppFilterAddress(value);

/**
 * Convert a Canton party address (`<<CANTON_PARTY::hint::fingerprint>>`) back to its raw party id
 * (`hint::fingerprint`). This is the inverse of {@link cantonPartyAddress} / {@link toCantonAddress}
 * for parties.
 *
 * A raw party id (`hint::fingerprint`, hex fingerprint) is also accepted and returned unchanged.
 *
 * @throws Error for contract-id (`<<CANTON_CID::...>>`), global (`<<CANTON_GLOBAL::...>>`), OApp filter
 *   (`<<CANTON_OAPP_FILTER::...>>`) and deferred
 *   (`<<CANTON_DEFERRED:...>>`) addresses, and for any malformed input.
 */
export const cantonAddressToPartyId = (address: string): string => {
    const isNonPartyAddress =
        address.startsWith(CANTON_CID_ADDRESS_PREFIX) ||
        address.startsWith(CANTON_GLOBAL_ADDRESS_PREFIX) ||
        address.startsWith(CANTON_OAPP_FILTER_ADDRESS_PREFIX) ||
        address.startsWith(CANTON_DEFERRED_VALUE_PREFIX);
    if (isNonPartyAddress) {
        throw new Error(`Not a Canton party address: ${address}`);
    }
    let candidate: string;
    if (address.startsWith(CANTON_PARTY_ADDRESS_PREFIX)) {
        if (!address.endsWith(CANTON_DEFERRED_VALUE_SUFFIX)) {
            throw new Error(`Not a Canton party address: ${address}`);
        }
        candidate = address.slice(
            CANTON_PARTY_ADDRESS_PREFIX.length,
            address.length - CANTON_DEFERRED_VALUE_SUFFIX.length,
        );
    } else if (address.startsWith('<<')) {
        throw new Error(`Not a Canton party address: ${address}`);
    } else {
        candidate = address;
    }
    const match = CANTON_PARTY_ID_REGEX.exec(candidate);
    if (!match || !match[1] || match[1].includes('<') || match[1].includes('>')) {
        throw new Error(`Not a Canton party address: ${address}`);
    }
    return `${match[1]}::${match[2]}`;
};
