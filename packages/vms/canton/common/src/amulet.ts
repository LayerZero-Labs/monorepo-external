import { z } from 'zod';

const AMULET_DECIMAL_PLACES = 10n;

const amuletPayloadSchema = z.object({
    amount: z.object({ initialAmount: z.string() }),
});

/**
 * Parses a DAML Decimal string (e.g. `"42.5000000000"`, `"-1.5"`) into a bigint
 * scaled by 10^10. Fractional digits beyond ten places are truncated towards zero.
 */
export const parseAmuletDecimal = (value: string): bigint => {
    const [integer, fraction = ''] = value.replace(/^-/, '').split('.');

    return (
        (value.startsWith('-') ? -1n : 1n) *
        (BigInt(integer || '0') * 10n ** AMULET_DECIMAL_PLACES +
            BigInt(
                fraction
                    .slice(0, Number(AMULET_DECIMAL_PLACES))
                    .padEnd(Number(AMULET_DECIMAL_PLACES), '0'),
            ))
    );
};

export const parseAmuletAmount = (createArgument: unknown): bigint =>
    parseAmuletDecimal(amuletPayloadSchema.parse(createArgument).amount.initialAmount);
