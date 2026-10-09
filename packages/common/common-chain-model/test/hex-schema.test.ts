import { describe, expect, it } from 'vitest';

import { hexSchema, isNormalizedHex } from '../src/address';

describe('hexSchema', () => {
    it('accepts valid 0x-prefixed hex', () => {
        expect(hexSchema.parse('0xdeadbeef')).toBe('0xdeadbeef');
        expect(hexSchema.parse('0x')).toBe('0x');
    });

    it('rejects malformed hex content', () => {
        // Prefix-only validation would let '0xZZ' through, then silently truncate downstream.
        expect(hexSchema.safeParse('0xZZ').success).toBe(false);
        expect(hexSchema.safeParse('0xdeadbeeg').success).toBe(false);
    });

    it('requires a lowercase 0x prefix (rejects unprefixed and 0X)', () => {
        expect(hexSchema.safeParse('deadbeef').success).toBe(false);
        expect(hexSchema.safeParse('0Xdeadbeef').success).toBe(false);
    });
});

describe('isNormalizedHex', () => {
    it('accepts already-normalized hex', () => {
        expect(isNormalizedHex('0xdeadbeef')).toBe(true);
        expect(isNormalizedHex('0x0')).toBe(true);
    });

    it('rejects leading zeros, uppercase, and non-hex', () => {
        expect(isNormalizedHex('0x0dead')).toBe(false);
        expect(isNormalizedHex('0xDEAD')).toBe(false);
        expect(isNormalizedHex('not-hex')).toBe(false);
    });
});
