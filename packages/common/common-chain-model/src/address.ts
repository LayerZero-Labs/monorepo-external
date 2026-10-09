import z from 'zod';

import { isHexString, trim0x } from '@layerzerolabs/common-encoding-utils';
import type { HexString, NormalizedHexString } from '@layerzerolabs/typescript-utils';
import { brandSchema } from '@layerzerolabs/zod-utils';

export type { HexString, NormalizedHexString };

export const hexSchema = z
    .string()
    // Require the 0x prefix and valid hex content: prefix-only validation lets malformed hex
    // through, where it silently truncates at decode.
    .refine((data) => data.startsWith('0x') && isHexString(data)) as z.ZodType<HexString>;

const _rawNormalizedHexSchema = z.string().refine((data) => {
    if (typeof data !== 'string') {
        return false;
    }
    if (!data.startsWith('0x')) {
        return false;
    }
    // Bare `0x` is invalid; the zero value must be written as `0x0`.
    if (data.length <= 2) {
        return false;
    }
    // Leading zeros after `0x` are forbidden except for the single-digit `0x0` case.
    if (data.length >= 4 && data[2] === '0') {
        return false;
    }
    if (data.toLowerCase() !== data) {
        return false;
    }
    const hexPart = trim0x(data);
    if (!/^[0-9a-f]+$/.test(hexPart)) {
        return false;
    }
    return true;
}) as any as z.ZodType<NormalizedHexString>;

export const normalizedHexSchema = brandSchema(_rawNormalizedHexSchema, 'NormalizedHexSchema');

/**
 * Returns true if `value` is already normalized hex (does not transform).
 *
 * Not a `value is NormalizedHexString` predicate: that brand is opaque (not a
 * string subtype), so callers narrow with a cast after this check.
 */
export const isNormalizedHex = (value: string): boolean =>
    normalizedHexSchema.safeParse(value).success;

export const normalizeHex = (address: HexString): NormalizedHexString => {
    const body = trim0x(address).replace(/^0+/, '');
    // All-zero input collapses to empty body; keep a single `0` so the result is `0x0`.
    const trimmed = '0x' + (body || '0');
    return trimmed.toLowerCase() as any as NormalizedHexString;
};

export const normalizedHexSort = (a: NormalizedHexString, b: NormalizedHexString) =>
    BigInt(a.toString()) - BigInt(b.toString()) > 0 ? 1 : -1;

export const sortNormalizedHex = <T extends NormalizedHexString[] | null>(hexStrings: T): T =>
    hexStrings === null ? hexStrings : (hexStrings.sort(normalizedHexSort) as T);

export const NORMALIZED_HEX_ZERO = normalizeHex('0x0');
