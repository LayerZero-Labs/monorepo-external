import z from 'zod';

import { type DecimalString } from '@layerzerolabs/typescript-utils';

export type { DecimalString };

export const decimalStringSchema = z.string().refine((data) => {
    return (
        // must be string
        typeof data === 'string' &&
        // must contain only digits, non-empty, can be negative
        data.match(/^-?\d+$/) !== null &&
        // must not start with 0 unless it's 0
        !(data[0] === '0' && data.length > 1) &&
        // allow -0, but still can't have multiple leading 0s
        !(data.startsWith('-0') && data.length > 2)
    );
}) as any as z.ZodType<DecimalString>;

export const decimalString = {
    parse: (data: string | bigint) => {
        if (typeof data === 'bigint') {
            return data.toString() as any as DecimalString;
        }
        if (typeof data === 'string') {
            if (data.match(/^\d+$/) === null) {
                throw new Error(`decimalString doesn't contain only digits: ${data}`);
            }
            // Normalize it as well to not have many surprises
            return BigInt(data).toString() as any as DecimalString;
        }
        throw new Error(`Invalid data: ${data}`);
    },

    toBigInt: (data: DecimalString) => {
        return BigInt(data as any as string);
    },
};
