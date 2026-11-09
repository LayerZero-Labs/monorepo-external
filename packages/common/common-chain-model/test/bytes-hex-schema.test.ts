import { describe, expect, it } from 'vitest';

import { bytes32HexSchema, bytesHexSchema, fixedBytesHexSchema } from '../src/address';

describe('bytesHexSchema', () => {
    it('accepts empty bytes and whole bytes, returned in lower case', () => {
        expect(bytesHexSchema.parse('0x')).toBe('0x');
        expect(bytesHexSchema.parse('0x00')).toBe('0x00');
        expect(bytesHexSchema.parse('0xABcd')).toBe('0xabcd');
    });

    it('rejects an odd number of hex digits, malformed hex, and a missing 0x prefix', () => {
        expect(bytesHexSchema.safeParse('0xabc').success).toBe(false);
        expect(bytesHexSchema.safeParse('0xzz').success).toBe(false);
        expect(bytesHexSchema.safeParse('abcd').success).toBe(false);
    });

    it('names whole bytes in the error for an odd number of hex digits', () => {
        const result = bytesHexSchema.safeParse('0xabc');

        expect(result.error?.issues.map(({ message }) => message)).toEqual(['must be whole bytes']);
    });
});

describe('fixedBytesHexSchema', () => {
    it('accepts exactly the given number of bytes, returned in lower case', () => {
        expect(fixedBytesHexSchema(4).parse('0x9DC29FAC')).toBe('0x9dc29fac');
    });

    it('rejects fewer and more bytes with an error that names the length', () => {
        const results = ['0x9dc29f', '0x9dc29fac00'].map((input) =>
            fixedBytesHexSchema(4)
                .safeParse(input)
                .error?.issues.map(({ message }) => message),
        );

        expect(results).toEqual([['must be 4 bytes'], ['must be 4 bytes']]);
    });

    it('rejects an odd number of hex digits', () => {
        expect(fixedBytesHexSchema(4).safeParse('0x9dc29fa').success).toBe(false);
    });
});

describe('bytes32HexSchema', () => {
    it('accepts 32 bytes, returned in lower case, and rejects 31 and 33 bytes', () => {
        expect(bytes32HexSchema.parse(`0x${'5A'.repeat(32)}`)).toBe(`0x${'5a'.repeat(32)}`);
        expect(bytes32HexSchema.safeParse(`0x${'5a'.repeat(31)}`).success).toBe(false);
        expect(bytes32HexSchema.safeParse(`0x${'5a'.repeat(33)}`).success).toBe(false);
    });
});
