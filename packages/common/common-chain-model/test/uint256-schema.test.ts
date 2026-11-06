import { describe, expect, it } from 'vitest';

import { uint256Schema } from '../src/bigint';

const maxUint256 = 2n ** 256n - 1n;

describe('uint256Schema', () => {
    it('accepts 0 and 2^256 - 1', () => {
        expect(uint256Schema.parse('0')).toBe('0');
        expect(uint256Schema.parse(maxUint256.toString())).toBe(maxUint256.toString());
    });

    it('rejects a negative value, a non-integer, and a value above 2^256 - 1', () => {
        expect(uint256Schema.safeParse('-1').success).toBe(false);
        expect(uint256Schema.safeParse('1.5').success).toBe(false);
        expect(uint256Schema.safeParse((maxUint256 + 1n).toString()).success).toBe(false);
    });

    it('names the allowed range in the error for a value above 2^256 - 1', () => {
        const result = uint256Schema.safeParse((maxUint256 + 1n).toString());

        expect(result.error?.issues.map(({ message }) => message)).toEqual([
            `must be between 0 and ${maxUint256.toString()}`,
        ]);
    });
});
