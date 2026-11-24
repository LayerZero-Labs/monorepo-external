import { describe, expect, it } from 'vitest';

import {
    assertHexLength,
    codePointLength,
    formatDamlDecimal,
    intToHex,
    keccak256Hex,
    padLeft,
    showBool,
    showInt,
    textToHex,
    timeToUnixSeconds,
    toBigInt,
} from '../src/daml-serde';
import { IntLikeSchema } from '../src/types';

describe('toBigInt', () => {
    it('passes through bigints and converts safe-integer numbers', () => {
        expect(toBigInt(5)).toBe(5n);
        expect(toBigInt(7n)).toBe(7n);
    });

    it('rejects unsafe-integer numbers', () => {
        expect(() => toBigInt(2 ** 53)).toThrow(/safe integer/);
    });
});

describe('IntLikeSchema', () => {
    it('accepts bigints and safe-integer numbers (incl. negatives)', () => {
        expect(IntLikeSchema.parse(5)).toBe(5);
        expect(IntLikeSchema.parse(-5)).toBe(-5);
        expect(IntLikeSchema.parse(2n ** 64n)).toBe(2n ** 64n);
    });

    it('rejects unsafe-integer numbers (must use a bigint)', () => {
        expect(IntLikeSchema.safeParse(2 ** 53).success).toBe(false);
    });
});

describe('textToHex', () => {
    it('encodes ASCII two hex digits per char', () => {
        expect(textToHex('01')).toBe('3031');
        expect(textToHex('setSeed')).toBe('73657453656564');
    });

    it('rejects non-ASCII code points', () => {
        expect(() => textToHex('café')).toThrow(/Non-ASCII/);
    });
});

describe('intToHex', () => {
    it('is minimal and lowercase', () => {
        expect(intToHex(0)).toBe('0');
        expect(intToHex(255)).toBe('ff');
        expect(intToHex(2n ** 63n - 1n)).toBe('7fffffffffffffff');
    });

    it('rejects negative values', () => {
        expect(() => intToHex(-1)).toThrow(/negative/);
    });
});

describe('padLeft', () => {
    it('left-pads with zeros and rejects oversize values', () => {
        expect(padLeft(16, '15180')).toBe('0000000000015180');
        expect(() => padLeft(2, 'abc')).toThrow(/exceeds pad width/);
    });
});

describe('assertHexLength', () => {
    it('returns stripped lowercase hex of the exact length', () => {
        expect(assertHexLength(4, '0xABcd')).toBe('abcd');
    });

    it('rejects wrong length, odd length, and non-hex', () => {
        expect(() => assertHexLength(4, 'abc')).toThrow();
        expect(() => assertHexLength(4, 'abcde')).toThrow();
        expect(() => assertHexLength(4, 'zzzz')).toThrow();
    });
});

describe('show helpers', () => {
    it('showBool capitalizes like DAML', () => {
        expect(showBool(true)).toBe('True');
        expect(showBool(false)).toBe('False');
    });

    it('showInt is base-10', () => {
        expect(showInt(0)).toBe('0');
        expect(showInt(-5)).toBe('-5');
        expect(showInt(123n)).toBe('123');
    });
});

describe('formatDamlDecimal', () => {
    it('keeps at least one fractional digit and strips trailing zeros', () => {
        expect(formatDamlDecimal('1.50')).toBe('1.5');
        expect(formatDamlDecimal('100')).toBe('100.0');
        expect(formatDamlDecimal('0')).toBe('0.0');
        expect(formatDamlDecimal('-1.5')).toBe('-1.5');
    });

    it('rejects more than 10 fractional digits and exponent notation', () => {
        expect(() => formatDamlDecimal('0.123456789012')).toThrow();
        expect(() => formatDamlDecimal(1e-12)).toThrow();
    });
});

describe('keccak256Hex', () => {
    it('hashes the bytes denoted by the hex string', () => {
        // keccak256 of the empty byte string.
        expect(keccak256Hex('')).toBe(
            'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470',
        );
        // keccak256 of the single byte 0x00.
        expect(keccak256Hex('00')).toBe(
            'bc36789e7a1e281436464229828f817d6612f7b477d66591ff96a9e064bcc98a',
        );
    });

    it('rejects malformed hex rather than hashing raw text', () => {
        expect(() => keccak256Hex('xyz')).toThrow(/valid hex/);
        expect(() => keccak256Hex('abc')).toThrow(/valid hex/);
    });
});

describe('codePointLength', () => {
    it('counts Unicode code points', () => {
        expect(codePointLength('alice')).toBe(5);
        expect(codePointLength('𝔸')).toBe(1);
    });
});

describe('timeToUnixSeconds', () => {
    it('returns whole seconds since the unix epoch', () => {
        expect(timeToUnixSeconds(new Date('1970-01-01T00:00:01.000Z'))).toBe(1n);
        expect(timeToUnixSeconds(new Date('2021-01-01T00:00:00.000Z'))).toBe(1609459200n);
    });
});
