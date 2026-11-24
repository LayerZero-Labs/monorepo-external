import { describe, expect, it } from 'vitest';

import {
    CANTON_DEFERRED_SENDER,
    isCantonDeferredSender,
    isCantonDeferredSentinel,
    isCantonPlaceholder,
    parseCantonDeferredValue,
} from '../src/deferredValue';

describe('CANTON_DEFERRED_SENDER', () => {
    it('is the typed sender token', () => {
        expect(isCantonDeferredSender(CANTON_DEFERRED_SENDER)).toBe(true);
        expect(isCantonDeferredSender('alice::1220ab')).toBe(false);
    });
});

describe('parseCantonDeferredValue', () => {
    it('returns undefined for non-sentinels', () => {
        expect(parseCantonDeferredValue('00abc')).toBeUndefined();
        expect(parseCantonDeferredValue({ type: 'senderParty' })).toBeUndefined();
    });

    it('parses a valid sentinel', () => {
        expect(parseCantonDeferredValue('<<CANTON_DEFERRED:{"type":"senderParty"}>>')).toEqual({
            type: 'senderParty',
        });
    });

    it('recognizes framing without accepting an invalid identity', () => {
        const malformed = '<<CANTON_DEFERRED:{"type":"activeContractId","templateId":"#pkg:T"}>>';
        expect(isCantonDeferredSentinel(malformed)).toBe(true);
        expect(parseCantonDeferredValue(malformed)).toBeUndefined();
        expect(isCantonPlaceholder(malformed)).toBe(false);
    });
});
