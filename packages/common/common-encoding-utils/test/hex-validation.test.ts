import { describe, expect, it } from 'vitest';

import {
    base58ToBytes,
    base58ToHex,
    base64ToBytes,
    base64ToHex,
    bigIntToBytes,
    bigIntToHex,
    bytesToBase58,
    bytesToBase64,
    bytesToBigInt,
    bytesToHexPrefixed,
    hexToAscii,
    hexToBase58,
    hexToBase64,
    hexToBigInt,
    hexToBytes,
    hexToNumber,
    hexZeroPad,
    isHexString,
    numberToHex,
} from '../src/index';

describe('isHexString', () => {
    it('accepts 0x-prefixed hex', () => {
        expect(isHexString('0xdeadbeef')).toBe(true);
    });

    it('accepts unprefixed hex', () => {
        expect(isHexString('deadbeef')).toBe(true);
    });

    it('rejects the uppercase 0X prefix (a manual-input error, not encoder output)', () => {
        expect(isHexString('0Xdeadbeef')).toBe(false);
    });

    it('accepts empty and bare 0x', () => {
        expect(isHexString('')).toBe(true);
        expect(isHexString('0x')).toBe(true);
    });

    it('rejects non-hex content', () => {
        expect(isHexString('0xZZ')).toBe(false);
        expect(isHexString('0xdeadbeeg')).toBe(false);
        expect(isHexString('hello')).toBe(false);
    });

    it('rejects non-strings', () => {
        expect(isHexString(undefined)).toBe(false);
        expect(isHexString(123)).toBe(false);
    });

    it('enforces an exact byte length when given', () => {
        expect(isHexString('0xdead', 2)).toBe(true);
        expect(isHexString('0xdead', 3)).toBe(false);
        // length is measured on the body, so it works for unprefixed input too
        expect(isHexString('deadbeef', 4)).toBe(true);
    });
});

describe('hexToBytes', () => {
    it('decodes 0x-prefixed hex', () => {
        expect(hexToBytes('0xdeadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('decodes unprefixed hex', () => {
        expect(hexToBytes('deadbeef')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it('rejects the uppercase 0X prefix', () => {
        expect(() => hexToBytes('0Xdeadbeef')).toThrow(/^invalid hex string \(length \d+\)$/);
    });

    it('throws on odd-length input instead of padding or truncating', () => {
        // A half-byte is a caller bug: the decoder rejects it rather than padding or truncating.
        expect(() => hexToBytes('0xfff')).toThrow(/odd length/);
        expect(() => hexToBytes('abc')).toThrow(/odd length/);
    });

    it('decodes empty/bare-0x to an empty array (isHexString accepts both)', () => {
        expect(hexToBytes('')).toEqual(new Uint8Array([]));
        expect(hexToBytes('0x')).toEqual(new Uint8Array([]));
    });

    it('throws on malformed hex instead of silently truncating', () => {
        // Anchored matcher pins the length-only message; a value-echoing regression would fail.
        expect(() => hexToBytes('0xZZ')).toThrow(/^invalid hex string \(length \d+\)$/);
        expect(() => hexToBytes('nothex')).toThrow(/^invalid hex string \(length \d+\)$/);
    });
});

describe('hexZeroPad', () => {
    it('left-pads to the target byte length', () => {
        expect(hexZeroPad('0xab', 2)).toBe('0x00ab');
        expect(hexZeroPad('0xabcd', 2)).toBe('0xabcd');
    });

    it('throws on malformed hex without echoing the value (signer-key/logs path)', () => {
        expect(() => hexZeroPad('0xZZ', 2)).toThrow(/^invalid hex string \(length \d+\)$/);
    });

    it('throws when the value is longer than the target length', () => {
        expect(() => hexZeroPad('0xabcdef', 2)).toThrow('value out of range');
    });

    it('normalizes unprefixed input so the overflow check is prefix-independent', () => {
        // Without normalization, 'abcdef' (3 bytes) slips past the length-2 overflow check.
        expect(hexZeroPad('ab', 2)).toBe('0x00ab');
        expect(() => hexZeroPad('abcdef', 2)).toThrow('value out of range');
    });

    it('rejects a fractional or NaN byte length (would yield odd-length output)', () => {
        // Guards bigIntToHex/bigIntToBytes/numberToHex, which all funnel their width through here.
        expect(() => hexZeroPad('0xab', 1.5)).toThrow(
            'byteLength must be a non-negative safe integer',
        );
        expect(() => bigIntToHex(1n, 1.5)).toThrow(
            'byteLength must be a non-negative safe integer',
        );
        expect(() => numberToHex(1, NaN)).toThrow('byteLength must be a non-negative safe integer');
    });
});

describe('hexToAscii', () => {
    it('decodes hex to ascii', () => {
        expect(hexToAscii('0x6162')).toBe('ab');
    });

    it('throws on odd-length input (matches hexToBytes)', () => {
        expect(() => hexToAscii('0x616')).toThrow(/odd length/);
    });
});

describe('hexToBase64', () => {
    it('round-trips through base64ToHex', () => {
        expect(base64ToHex(hexToBase64('0xdeadbeef'))).toBe('0xdeadbeef');
    });

    it('encodes empty hex to empty base64 (consistent with hexToBase58)', () => {
        expect(hexToBase64('0x')).toBe('');
    });

    it('rejects odd-length and non-hex input', () => {
        expect(() => hexToBase64('0xabc')).toThrow(/odd length/);
        expect(() => hexToBase64('0xZZ')).toThrow(/^invalid hex string \(length \d+\)$/);
    });
});

describe('base64ToBytes', () => {
    it('round-trips bytes through base64', () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    });

    it('throws on non-base64 input instead of silently truncating', () => {
        // A bare Buffer.from(_, 'base64') would drop the '*' and decode the rest to wrong bytes.
        expect(() => base64ToBytes('not*base64')).toThrow(/^invalid base64 string \(length \d+\)$/);
    });

    it('throws on a length not a multiple of 4 (would silently short-decode)', () => {
        // 'abc' passes the alphabet check, but Buffer.from would yield 2 bytes with nothing thrown.
        expect(() => base64ToBytes('abc')).toThrow(/^invalid base64 string \(length \d+\)$/);
    });
});

describe('round-trip', () => {
    it('hexToBytes -> bytesToHexPrefixed preserves the value', () => {
        const original = '0xdeadbeef';
        expect(bytesToHexPrefixed(hexToBytes(original))).toBe(original);
    });
});

describe('hex <-> bigint', () => {
    it('hexToBigInt parses prefixed/unprefixed/uppercase hex', () => {
        expect(hexToBigInt('0xff')).toBe(255n);
        expect(hexToBigInt('ff')).toBe(255n);
        expect(hexToBigInt('0xFFAA')).toBe(65450n);
    });

    it('hexToBigInt treats empty/bare-0x as 0n (not a throw)', () => {
        expect(hexToBigInt('0x')).toBe(0n);
        expect(hexToBigInt('')).toBe(0n);
    });

    it('hexToBigInt/hexToNumber accept odd-length hex (a number has no nibble alignment)', () => {
        // The deliberate asymmetry vs hexToBytes, which rejects odd length. Starknet felts are odd.
        expect(hexToBigInt('0xabc')).toBe(2748n);
        expect(hexToNumber('0xabc')).toBe(2748);
    });

    it('hexToBigInt throws on malformed hex', () => {
        expect(() => hexToBigInt('0xZZ')).toThrow(/^invalid hex string \(length \d+\)$/);
    });

    it('bytesToBigInt reads big-endian; empty is 0n', () => {
        expect(bytesToBigInt(new Uint8Array([0x01, 0x00]))).toBe(256n);
        expect(bytesToBigInt(new Uint8Array([]))).toBe(0n);
    });

    it('bigIntToHex round-trips and zero-pads to byteLength', () => {
        expect(bigIntToHex(255n)).toBe('0xff');
        expect(bigIntToHex(255n, 4)).toBe('0x000000ff');
        expect(hexToBigInt(bigIntToHex(123456789n))).toBe(123456789n);
    });

    it('encodes zero as 0x0 (a common nonce/amount input)', () => {
        expect(bigIntToHex(0n)).toBe('0x0');
        expect(numberToHex(0)).toBe('0x0');
    });

    it('bigIntToHex rejects negatives', () => {
        expect(() => bigIntToHex(-1n)).toThrow(/negative/);
    });

    it('bigIntToBytes is the big-endian, left-padded inverse of bytesToBigInt', () => {
        expect(bigIntToBytes(255n, 2)).toEqual(new Uint8Array([0x00, 0xff]));
        expect(bytesToBigInt(bigIntToBytes(123456789n, 8))).toBe(123456789n);
    });

    it('bigIntToBytes rejects negatives and values too wide for byteLength', () => {
        expect(() => bigIntToBytes(-1n, 4)).toThrow(/negative/);
        expect(() => bigIntToBytes(256n, 1)).toThrow('value out of range');
    });
});

describe('base58', () => {
    it('round-trips bytes through base58', () => {
        const bytes = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        expect(base58ToBytes(bytesToBase58(bytes))).toEqual(bytes);
    });

    it('round-trips hex through base58', () => {
        expect(base58ToHex(hexToBase58('0xdeadbeef'))).toBe('0xdeadbeef');
    });

    it('preserves leading zero bytes (each encodes to a leading "1")', () => {
        // The defining base58 edge: a 0x00 byte has no positional value, so it is encoded as a
        // literal leading '1'. Round-tripping must not drop it.
        const bytes = new Uint8Array([0x00, 0x00, 0xab, 0xcd]);
        const encoded = bytesToBase58(bytes);
        expect(encoded.startsWith('11')).toBe(true);
        expect(base58ToBytes(encoded)).toEqual(bytes);
    });

    it('throws on non-base58 input (0, O, I, l are not in the alphabet)', () => {
        expect(() => base58ToBytes('0OIl')).toThrow(/^invalid base58 string \(length \d+\)$/);
    });
});

describe('hex <-> number', () => {
    it('numberToHex / hexToNumber round-trip', () => {
        expect(numberToHex(255)).toBe('0xff');
        expect(numberToHex(255, 2)).toBe('0x00ff');
        expect(hexToNumber('0x100')).toBe(256);
        expect(hexToNumber(numberToHex(70000))).toBe(70000);
    });

    it('numberToHex rejects non-integers, negatives, and unsafe integers', () => {
        expect(() => numberToHex(1.5)).toThrow();
        expect(() => numberToHex(-1)).toThrow();
        // 2^53 is past MAX_SAFE_INTEGER; reject rather than encode a silently-rounded value
        // (symmetric with hexToNumber below).
        expect(() => numberToHex(2 ** 53)).toThrow();
    });

    it('hexToNumber pins the MAX_SAFE_INTEGER boundary (> not >=)', () => {
        // 2^53 - 1 is exactly MAX_SAFE_INTEGER and must still decode.
        expect(hexToNumber('0x1fffffffffffff')).toBe(9007199254740991);
        // 2^53 is the first unsafe value and must throw.
        expect(() => hexToNumber('0x20000000000000')).toThrow(/MAX_SAFE_INTEGER/);
        expect(() => hexToNumber('0xffffffffffffffffff')).toThrow(/MAX_SAFE_INTEGER/);
    });
});
