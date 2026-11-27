import { describe, expect, it } from 'vitest';

import {
    cantonCidAddress,
    cantonDeferredAddress,
    cantonOAppFilterAddress,
    cantonPartyAddress,
    isCantonAddress,
    toCantonAddress,
} from '@layerzerolabs/common-canton';
import { cantonGlobalAddress, isCantonGlobalAddress } from '@layerzerolabs/common-canton/browser';
import { normalizeHex } from '@layerzerolabs/common-chain-model';
import { tileHex, trim0x } from '@layerzerolabs/common-encoding-utils';
import { type CantonString, ChainName } from '@layerzerolabs/layerzero-definitions';

import { addressParser } from '../src/addressParser';
import { decodeCantonRefAddress, encodeCantonRefAddress } from '../src/addressParser/canton';

const parser = addressParser(ChainName.CANTON);

const asNative = (address: string): CantonString => {
    if (!parser.validateNative(address)) throw new Error(`Not a native Canton address: ${address}`);
    return address;
};

describe('cantonAddressParser.parseNative', () => {
    it('normalizes a party address with the `01` discriminator', () => {
        const party = cantonPartyAddress('myhint', '1220abcdef');
        const hintHex = Buffer.from('myhint', 'utf-8').toString('hex');
        expect(parser.parseNative(party)).toBe(normalizeHex(`0x1220abcdef${hintHex}01`));
        expect(String(parser.parseNative(party)).endsWith('01')).toBe(true);
    });

    it('normalizes a contract-ID address with the `00` discriminator', () => {
        const contractId = '00' + 'a'.repeat(136);
        const addr = cantonCidAddress(contractId);
        expect(parser.parseNative(addr)).toBe(normalizeHex(`0x${contractId}00`));
        expect(String(parser.parseNative(addr)).endsWith('00')).toBe(true);
    });

    it('normalizes a deferred-ref sentinel with the `02` discriminator (framing stripped)', () => {
        const ref = cantonDeferredAddress(
            '<<CANTON_DEFERRED:{"type":"activeContractId","templateId":"Pkg:Mod:Tpl"}>>',
        );
        const innerHex = Buffer.from(
            '{"type":"activeContractId","templateId":"Pkg:Mod:Tpl"}',
            'utf-8',
        ).toString('hex');
        expect(parser.parseNative(ref)).toBe(normalizeHex(`0x${innerHex}02`));
        expect(String(parser.parseNative(ref)).endsWith('02')).toBe(true);
    });

    it('rejects an untagged global CHAIN address', () => {
        const verGlobal = tileHex('bb', 64);
        expect(() => parser.parseNative(verGlobal)).toThrow();
    });

    it('rejects a bare (no-0x) bytes32 hex (not a Canton-native address)', () => {
        const verGlobal = trim0x(tileHex('cc', 64));
        expect(() => parser.parseNative(verGlobal)).toThrow();
    });
});

describe('isCantonAddress', () => {
    it('identifies the three sentinel forms', () => {
        expect(isCantonAddress(cantonPartyAddress('alice', REAL_FINGERPRINT))).toBe(true);
        expect(isCantonAddress(cantonCidAddress('00' + 'a'.repeat(136)))).toBe(true);
        expect(
            isCantonAddress(cantonDeferredAddress('<<CANTON_DEFERRED:{"type":"senderParty"}>>')),
        ).toBe(true);
    });

    it('returns false for raw ledger strings and non-canton values', () => {
        expect(isCantonAddress('myhint::1220abcdef')).toBe(false);
        expect(isCantonAddress('00' + 'a'.repeat(136))).toBe(false);
        expect(isCantonAddress('not-a-canton-address')).toBe(false);
    });
});

describe('toCantonAddress', () => {
    it('wraps a raw party string', () => {
        const addr = toCantonAddress('myhint::1220abcdef');
        expect(addr).toBe('<<CANTON_PARTY::myhint::1220abcdef>>');
        expect(isCantonAddress(addr)).toBe(true);
    });

    it('wraps a raw contract id', () => {
        const cid = '00' + 'a'.repeat(136);
        const addr = toCantonAddress(cid);
        expect(addr).toBe(`<<CANTON_CID::${cid}>>`);
        expect(isCantonAddress(addr)).toBe(true);
    });

    it('strips 0x prefix from contract id before embedding in sentinel', () => {
        const cid = '00' + 'a'.repeat(136);
        const addr = toCantonAddress('0x' + cid);
        expect(addr).toBe(`<<CANTON_CID::${cid}>>`);
        expect(addr).not.toContain('0x');
    });

    it('wraps a deferred ref sentinel as-is', () => {
        const sentinel = '<<CANTON_DEFERRED:{"type":"senderParty"}>>';
        expect(toCantonAddress(sentinel)).toBe(sentinel);
    });

    it('throws for non-Canton strings', () => {
        expect(() => toCantonAddress('not-a-canton-address')).toThrow();
    });
});

describe('cantonAddressParser deferred-ref round-trip', () => {
    const ref = cantonDeferredAddress(
        '<<CANTON_DEFERRED:{"type":"activeContractId","partyToFilter":{"party":"alice::1220ab"},"expectedSignatories":["alice::1220ab"],"templateId":"Pkg:Mod:Tpl"}>>',
    );

    it('validates a deferred-ref address as a native address', () => {
        expect(parser.validateNative(ref)).toBe(true);
    });

    it('rejects a raw party string as a native address', () => {
        expect(parser.validateNative('alice::1220ab')).toBe(false);
    });

    it('round-trips a deferred ref through normalize -> reconstruct', () => {
        const normalized = parser.nativeToNormalized(asNative(ref));
        expect(parser.normalizedToNativeString(normalized)).toBe(ref);
    });
});

// Realistic fingerprint: '1220' (multihash prefix) + 64 hex chars (SHA-256)
const REAL_FINGERPRINT = '1220' + 'a'.repeat(64);

describe('canton extension methods', () => {
    it('normalizedToParty round-trips from party address', () => {
        const party = cantonPartyAddress('alice', REAL_FINGERPRINT);
        const normalized = parser.nativeToNormalized(asNative(party));
        expect(parser.normalizedToParty(normalized)).toBe(`alice::${REAL_FINGERPRINT}`);
    });

    it('normalizedToCid round-trips from CID address', () => {
        const cid = '00' + 'a'.repeat(136);
        const addr = cantonCidAddress(cid);
        const normalized = parser.nativeToNormalized(asNative(addr));
        expect(parser.normalizedToCid(normalized)).toBe(cid);
    });

    it('normalizedToParty throws for a CID address', () => {
        const addr = cantonCidAddress('00' + 'a'.repeat(136));
        const normalized = parser.nativeToNormalized(asNative(addr));
        expect(() => parser.normalizedToParty(normalized)).toThrow();
    });

    it('toLedgerParty resolves every party form to the raw ledger party', () => {
        const raw = `alice::${REAL_FINGERPRINT}`;
        const sentinel = cantonPartyAddress('alice', REAL_FINGERPRINT);
        expect(parser.toLedgerParty(String(parser.nativeToNormalized(asNative(sentinel))))).toBe(
            raw,
        );
        expect(parser.toLedgerParty(sentinel)).toBe(raw);
        expect(parser.toLedgerParty(raw)).toBe(raw);
    });

    it('toLedgerParty throws for a CID address', () => {
        const addr = cantonCidAddress('00' + 'a'.repeat(136));
        expect(() =>
            parser.toLedgerParty(String(parser.nativeToNormalized(asNative(addr)))),
        ).toThrow();
        expect(() => parser.toLedgerParty(addr)).toThrow();
    });

    it('normalizedToDeferredValue round-trips for a deferred ref', () => {
        const sentinel = '<<CANTON_DEFERRED:{"type":"senderParty"}>>';
        const addr = cantonDeferredAddress(sentinel);
        const normalized = parser.nativeToNormalized(asNative(addr));
        const ref = parser.normalizedToDeferredValue(normalized);
        expect(ref).toEqual({ type: 'senderParty' });
    });
});

describe('encode/decode ref-address', () => {
    const sentinel =
        '<<CANTON_DEFERRED:{"type":"activeContractId","partyToFilter":{"party":"alice::1220ab"},"expectedSignatories":["alice::1220ab"],"templateId":"#pkg:Mod:Tpl"}>>';

    it('round-trips sentinel -> address -> sentinel', () => {
        const addr = encodeCantonRefAddress(sentinel);
        expect(String(addr).endsWith('02')).toBe(true);
        expect(decodeCantonRefAddress(String(addr))).toBe(sentinel);
    });

    it('decode returns undefined for a non-ref (contract id) address', () => {
        const contractId = '00' + 'a'.repeat(136);
        const addr = cantonCidAddress(contractId);
        expect(decodeCantonRefAddress(String(parser.parseNative(addr)))).toBeUndefined();
    });
});

describe('Canton global peer encoding', () => {
    it.each(['00', '01', '02', '03', 'ff'])(
        'round-trips a peer ending in %s through existing VM parser calls',
        (suffix) => {
            const bytes32 = `0x00${'ab'.repeat(30)}${suffix}` as const;
            const peer = parser.bytes32ToNormalized(bytes32);
            const native = parser.normalizedToNativeString(peer);
            expect(peer).toBe(normalizeHex(`${bytes32}03`));
            expect(native).toBe(cantonGlobalAddress(bytes32));
            expect(parser.validateNative(native)).toBe(true);
            expect(parser.parseNative(native)).toBe(peer);
            expect(parser.nativeToNormalized(native)).toBe(peer);
            expect(parser.normalizedToNative(peer)).toEqual({
                chainName: ChainName.CANTON,
                nativeAddress: cantonGlobalAddress(bytes32),
            });
            expect(parser.normalizedToBytes32Hex(peer)).toBe(bytes32);
            expect(parser.nativeToBytes32Hex(native)).toBe(bytes32);
            expect(parser.normalizedToBytes32(peer)).toEqual(parser.nativeToBytes32(native));
            expect(parser.nativeToBytes(native)).toEqual(parser.normalizedToBytes32(peer));
            expect(parser.nativeToBytes32(native)).toHaveLength(32);
            expect(() => parser.normalizedToParty(peer)).toThrow();
            expect(() => parser.normalizedToCid(peer)).toThrow();
            expect(() => parser.normalizedToDeferredValue(peer)).toThrow();
        },
    );

    it.each(['senderParty', 'amuletRulesCid', 'amuletContext'])(
        'rejects the short %s deferred reference as a peer',
        (type) => {
            const native = cantonDeferredAddress(`<<CANTON_DEFERRED:${JSON.stringify({ type })}>>`);
            const normalized = parser.parseNative(native);
            expect(parser.normalizedToNativeString(normalized)).toBe(native);
            expect(() => parser.normalizedToBytes32Hex(normalized)).toThrow();
            expect(() => parser.nativeToBytes32(asNative(native))).toThrow();
        },
    );

    it('rejects ledger identities and oversized values as peers', () => {
        for (const native of [
            cantonPartyAddress('alice', REAL_FINGERPRINT),
            cantonCidAddress('00' + 'a'.repeat(136)),
        ]) {
            const normalized = parser.parseNative(native);
            expect(parser.normalizedToNativeString(normalized)).toBe(native);
            expect(() => parser.normalizedToBytes32Hex(normalized)).toThrow();
            expect(() => parser.nativeToBytes32Hex(asNative(native))).toThrow();
        }
        expect(() => parser.normalizedToBytes32Hex(normalizeHex(`0x${'ab'.repeat(33)}`))).toThrow();
    });

    it('preserves undefined for optional addresses', () => {
        expect(parser.bytes32ToNormalized(undefined)).toBeUndefined();
        expect(parser.normalizedToBytes32Hex(undefined)).toBeUndefined();
        expect(parser.normalizedToBytes32(undefined)).toBeUndefined();
        expect(parser.nativeToBytes32Hex(undefined)).toBeUndefined();
        expect(parser.nativeToBytes32(undefined)).toBeUndefined();
    });

    it('distinguishes a hash containing a deferred payload from the deferred reference', () => {
        const sentinel = cantonDeferredAddress('<<CANTON_DEFERRED:{"type":"senderParty"}>>');
        const deferred = parser.parseNative(sentinel);
        const global = parser.bytes32ToNormalized(
            `0x${String(deferred).slice(2).padStart(64, '0')}`,
        );
        expect(global).not.toBe(deferred);
        expect(parser.normalizedToBytes32Hex(global)).toBe(
            `0x${String(deferred).slice(2).padStart(64, '0')}`,
        );
        expect(() => parser.normalizedToBytes32Hex(deferred)).toThrow();
        expect(parser.normalizedToDeferredValue(deferred)).toEqual({ type: 'senderParty' });
    });

    it('round-trips zero despite normalized hex stripping the leading tag nibble', () => {
        const global = parser.bytes32ToNormalized(`0x${'00'.repeat(32)}`);
        expect(global).toBe(normalizeHex('0x03'));
        expect(parser.normalizedToBytes32Hex(global)).toBe(`0x${'00'.repeat(32)}`);
    });

    it('validates explicit global constructors and rejects untagged native hex', () => {
        for (const invalid of ['0x', 'nope', `0x${'ab'.repeat(33)}`]) {
            expect(() => cantonGlobalAddress(invalid)).toThrow();
        }
        expect(isCantonGlobalAddress('<<CANTON_GLOBAL::0xabc>>')).toBe(false);
        expect(parser.validateNative(`0x${'ab'.repeat(32)}`)).toBe(false);
        expect(parser.validateNative(cantonGlobalAddress('0x123'))).toBe(true);
    });
});

describe('Canton OApp filter address (type 04)', () => {
    const PARTY_ID = `DSO::1220${'be'.repeat(32)}`;
    const OAPP_FILTER = cantonOAppFilterAddress(PARTY_ID, 'Amulet');
    const NORMALIZED = `0x${Buffer.from(`${PARTY_ID}|Amulet`, 'utf-8').toString('hex')}04`;

    it('normalizes to utf8(`{partyId}|{id}`) with the `04` discriminator', () => {
        expect(parser.parseNative(OAPP_FILTER)).toBe(NORMALIZED);
        expect(parser.nativeToNormalized(asNative(OAPP_FILTER))).toBe(NORMALIZED);
    });

    it('denormalizes back to the same sentinel', () => {
        expect(parser.normalizedToNativeString(parser.parseNative(OAPP_FILTER))).toBe(OAPP_FILTER);
        expect(parser.normalizedToNative(parser.parseNative(OAPP_FILTER)).nativeAddress).toBe(
            OAPP_FILTER,
        );
    });

    it('keeps letter case and multi-byte characters', () => {
        const address = cantonOAppFilterAddress(`Hint-Ü::1220${'AB'.repeat(32)}`, 'Oft::Ünïcode');
        expect(parser.normalizedToNativeString(parser.parseNative(address))).toBe(address);
    });

    it('is accepted by validateNative', () => {
        expect(parser.validateNative(OAPP_FILTER)).toBe(true);
    });

    it('returns the utf8 bytes of the inner value from nativeToBytes', () => {
        expect(Buffer.from(parser.nativeToBytes(asNative(OAPP_FILTER))).toString('utf-8')).toBe(
            `${PARTY_ID}|Amulet`,
        );
    });

    it('rejects bytes32, party and contract-id conversions', () => {
        const normalized = parser.parseNative(OAPP_FILTER);
        expect(() => parser.nativeToBytes32Hex(asNative(OAPP_FILTER))).toThrow();
        expect(() => parser.normalizedToBytes32Hex(normalized)).toThrow();
        expect(() => parser.normalizedToParty(normalized)).toThrow(/Not a canton party address/);
        expect(() => parser.normalizedToCid(normalized)).toThrow(/Not a canton contract ID/);
    });

    it.each([
        ['no delimiter', `${PARTY_ID}`],
        ['an empty id', `${PARTY_ID}|`],
        ['an id with `|`', `${PARTY_ID}|a|b`],
        ['a bad party id', 'DSO|Amulet'],
    ])('rejects a normalized value with %s', (_label, inner) => {
        const hex = normalizeHex(`0x${Buffer.from(inner, 'utf-8').toString('hex')}04`);
        expect(() => parser.normalizedToNativeString(hex)).toThrow(
            /Malformed Canton OApp filter address/,
        );
    });

    it('rejects a normalized value that is not valid hex', () => {
        expect(() =>
            parser.normalizedToNativeString(`${NORMALIZED.slice(0, -4)}zz04` as any),
        ).toThrow(/Malformed Canton OApp filter address/);
    });
});
