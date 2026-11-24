import { describe, expect, it } from 'vitest';

import { bytes32Schema, toBytes32 } from '../src/address';

const UPPER = `0x${'AB'.repeat(32)}`;
const LOWER = `0x${'ab'.repeat(32)}`;

describe('Bytes32String', () => {
    it('bytes32Schema returns lower case', () => {
        expect(bytes32Schema.parse(UPPER)).toBe(LOWER);
    });

    it('toBytes32 returns lower case', () => {
        expect(toBytes32(UPPER as `0x${string}`)).toBe(LOWER);
    });

    it('rejects a value that is not 32 bytes', () => {
        expect(bytes32Schema.safeParse('0xabcd').success).toBe(false);
        expect(() => toBytes32('0xabcd')).toThrow();
    });
});
