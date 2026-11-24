import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { NonRetryableError } from '@layerzerolabs/common-error-utils';

import { parseInput } from './input';

const schema = z.object({
    owner: z.string().startsWith('0x'),
    config: z.object({ decimals: z.number().int().max(18) }),
});

describe('parseInput', () => {
    it('returns the parsed data for a valid input', () => {
        const input = { owner: '0xabc', config: { decimals: 6 } };

        expect(parseInput(schema, input, 'deploy input')).toEqual(input);
    });

    it('throws a NonRetryableError that names the description and the path and message of each issue', () => {
        const error = (() => {
            try {
                parseInput(schema, { owner: 'abc', config: { decimals: 19 } }, 'deploy input');
            } catch (caught) {
                return caught;
            }
            throw new Error('Expected parseInput to throw');
        })();

        expect(error).toBeInstanceOf(NonRetryableError);
        expect(error instanceof Error && error.message).toBe(
            'Invalid deploy input: owner Invalid string: must start with "0x"; config.decimals Too big: expected number to be <=18',
        );
    });
});
