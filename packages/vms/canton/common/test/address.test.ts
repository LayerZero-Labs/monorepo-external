import { describe, expect, it } from 'vitest';

import {
    cantonAddressToPartyId,
    cantonCidAddress,
    cantonGlobalAddress,
    cantonOAppFilterAddress,
    cantonPartyAddress,
    isCantonAddress,
    isCantonOAppFilterAddress,
    parseCantonGlobalAddress,
    parseCantonOAppFilterAddress,
    toCantonGlobalAddress,
    toCantonAddress,
} from '../src/address';
import { encodeCantonDeferredValue } from '../src/deferredValue';

const HINT = 'lzonesig-scenario';
const FP = '1220cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const PARTY_ID = `${HINT}::${FP}`;

describe('cantonAddressToPartyId', () => {
    it('round trips with cantonPartyAddress', () => {
        expect(cantonAddressToPartyId(cantonPartyAddress(HINT, FP))).toBe(PARTY_ID);
    });

    it('round trips with toCantonAddress', () => {
        const address = toCantonAddress(PARTY_ID);
        expect(address).toBe(`<<CANTON_PARTY::${PARTY_ID}>>`);
        expect(cantonAddressToPartyId(address)).toBe(PARTY_ID);
    });

    it('returns a raw party id unchanged', () => {
        expect(cantonAddressToPartyId(PARTY_ID)).toBe(PARTY_ID);
    });

    it('rejects contract-id addresses', () => {
        const cid = cantonCidAddress(`00${'ab'.repeat(68)}`);
        expect(() => cantonAddressToPartyId(cid)).toThrow(/Not a Canton party address/);
    });

    it('rejects global addresses', () => {
        expect(() => cantonAddressToPartyId(cantonGlobalAddress('0x1234'))).toThrow(
            /Not a Canton party address/,
        );
    });

    it('rejects OApp filter addresses', () => {
        expect(() => cantonAddressToPartyId(cantonOAppFilterAddress(PARTY_ID, 'Amulet'))).toThrow(
            /Not a Canton party address/,
        );
    });

    it('rejects deferred addresses', () => {
        const deferred = encodeCantonDeferredValue({ type: 'senderParty' });
        expect(() => cantonAddressToPartyId(deferred)).toThrow(/Not a Canton party address/);
        expect(() => cantonAddressToPartyId('<<CANTON_DEFERRED:{}>>')).toThrow(
            /Not a Canton party address/,
        );
    });

    it.each([
        '',
        '<<CANTON_PARTY::onlyhint>>',
        '<<CANTON_PARTY::::1220cc>>',
        `<<CANTON_PARTY::${PARTY_ID}`,
        'hint::fp',
        'no-separator',
        `<<SOMETHING::${PARTY_ID}>>`,
        // A bare contract id (no `hint::` separator).
        `00${'ab'.repeat(68)}`,
    ])('rejects malformed input %j', (input) => {
        expect(() => cantonAddressToPartyId(input)).toThrow(/Not a Canton party address/);
    });
});

describe('cantonOAppFilterAddress', () => {
    const OAPP_FILTER_ADDRESS = `<<CANTON_OAPP_FILTER::${PARTY_ID}|Amulet>>`;

    it('builds the sentinel from a party id and an id', () => {
        expect(cantonOAppFilterAddress(PARTY_ID, 'Amulet')).toBe(OAPP_FILTER_ADDRESS);
    });

    it('round trips with parseCantonOAppFilterAddress', () => {
        expect(parseCantonOAppFilterAddress(OAPP_FILTER_ADDRESS)).toEqual({
            partyId: PARTY_ID,
            id: 'Amulet',
        });
    });

    it('keeps the letter case and `::` inside the hint and id', () => {
        const partyId = `My::Hint::${FP.toUpperCase()}`;
        const address = cantonOAppFilterAddress(partyId, 'Oft::V2');
        expect(parseCantonOAppFilterAddress(address)).toEqual({ partyId, id: 'Oft::V2' });
    });

    it('is recognised by isCantonOAppFilterAddress and isCantonAddress', () => {
        expect(isCantonOAppFilterAddress(OAPP_FILTER_ADDRESS)).toBe(true);
        expect(isCantonAddress(OAPP_FILTER_ADDRESS)).toBe(true);
    });

    it('rejects an id that contains `|`', () => {
        expect(() => cantonOAppFilterAddress(PARTY_ID, 'a|b')).toThrow(/must not contain '\|'/);
    });

    it.each([
        ['an empty id', PARTY_ID, ''],
        ['a party id without a fingerprint', HINT, 'Amulet'],
        ['a party id with a non-hex fingerprint', `${HINT}::xyz`, 'Amulet'],
        ['a party id with an empty hint', `::${FP}`, 'Amulet'],
        ['a party id that contains `|`', `a|b::${FP}`, 'Amulet'],
        ['a party id that contains `<`', `<a::${FP}`, 'Amulet'],
    ])('rejects %s', (_label, partyId, id) => {
        expect(() => cantonOAppFilterAddress(partyId, id)).toThrow(/Invalid Canton OApp filter/);
    });

    it.each([
        '',
        PARTY_ID,
        `${PARTY_ID}|Amulet`,
        `<<CANTON_PARTY::${PARTY_ID}>>`,
        `<<CANTON_OAPP_FILTER::${PARTY_ID}>>`,
        `<<CANTON_OAPP_FILTER::${PARTY_ID}|>>`,
        `<<CANTON_OAPP_FILTER::${PARTY_ID}|a|b>>`,
        `<<CANTON_OAPP_FILTER::${PARTY_ID}|Amulet`,
        `<<CANTON_OAPP_FILTER::${HINT}|Amulet>>`,
    ])('does not accept malformed input %j', (input) => {
        expect(isCantonOAppFilterAddress(input)).toBe(false);
        expect(() => parseCantonOAppFilterAddress(input)).toThrow(
            /Not a Canton OApp filter address/,
        );
    });
});

describe('parseCantonGlobalAddress', () => {
    const BYTES32 = `0x${'ab'.repeat(32)}`;

    it('round trips with cantonGlobalAddress', () => {
        expect(parseCantonGlobalAddress(cantonGlobalAddress(BYTES32))).toBe(BYTES32);
    });

    it('returns the bytes32 in lowercase', () => {
        expect(parseCantonGlobalAddress(`<<CANTON_GLOBAL::0x${'AB'.repeat(32)}>>`)).toBe(BYTES32);
    });

    it.each([
        '',
        BYTES32,
        `<<CANTON_GLOBAL::${BYTES32}`,
        `<<CANTON_GLOBAL::0x${'ab'.repeat(31)}>>`,
        `<<CANTON_PARTY::${PARTY_ID}>>`,
        `<<CANTON_OAPP_FILTER::${PARTY_ID}|Amulet>>`,
    ])('rejects %j', (input) => {
        expect(() => parseCantonGlobalAddress(input)).toThrow(/Not a Canton global address/);
    });
});

describe('toCantonGlobalAddress', () => {
    const BYTES32 = `0x${'ab'.repeat(32)}`;

    it('wraps a raw bytes32 like cantonGlobalAddress', () => {
        expect(toCantonGlobalAddress(BYTES32)).toBe(cantonGlobalAddress(BYTES32));
        expect(toCantonGlobalAddress('0xABCD')).toBe(cantonGlobalAddress('0xABCD'));
    });

    it('returns a global address sentinel unchanged', () => {
        const sentinel = cantonGlobalAddress(BYTES32);
        expect(toCantonGlobalAddress(sentinel)).toBe(sentinel);
    });

    it('rejects a value that is not hex', () => {
        expect(() => toCantonGlobalAddress(`<<CANTON_PARTY::${PARTY_ID}>>`)).toThrow(
            /Invalid Canton global bytes32 address/,
        );
    });
});
