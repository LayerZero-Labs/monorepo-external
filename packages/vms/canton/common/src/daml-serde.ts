/**
 * Low-level serialization helpers that are byte-for-byte mirrors of the DAML
 * `Serde.Serde` module and the relevant `show` instances. Everything here operates
 * on **hex-encoded byte strings** (lowercase, no `0x` prefix) or DAML primitive
 * renderings, so an off-chain encoder produces the exact bytes the ledger verifies.
 *
 * Kept dependency-light (no ledger client) so encoding/signing SDKs can reuse it.
 */

import { keccak_256 } from '@noble/hashes/sha3';

import { bigIntToHex, bytesToHex, hexToBytes, trim0x } from '@layerzerolabs/common-encoding-utils';

import type { IntLike } from './types';

const HEX_DIGITS = /^[0-9a-fA-F]*$/;

/** Convert an {@link IntLike} to a `bigint`, rejecting unsafe-integer `number`s. */
export function toBigInt(value: IntLike, label = 'value'): bigint {
    if (typeof value === 'bigint') return value;
    // `number` only represents integers exactly up to MAX_SAFE_INTEGER; a larger
    // value has already lost precision as a float, so reject it and require a
    // bigint rather than encoding a silently-rounded oneSigId / nonce / Int.
    if (!Number.isSafeInteger(value)) {
        throw new Error(
            `${label} must be a safe integer; pass a bigint for values beyond Number.MAX_SAFE_INTEGER, got ${value}`,
        );
    }
    return BigInt(value);
}

/**
 * Unicode code-point count of a string — the measure DAML's `T.length` uses for
 * `lengthPrefix`. For the ASCII values encoded here this equals the byte count,
 * but we count code points (not UTF-16 units) so astral characters are measured
 * the same way DAML measures them.
 */
export function codePointLength(value: string): number {
    let count = 0;
    for (const _ of value) count++;
    return count;
}

/** DAML `show` of an `Int`: a base-10 string, negatives prefixed with `-`. */
export function showInt(value: IntLike): string {
    return toBigInt(value, 'int').toString(10);
}

/** DAML `show` of a `Bool`: `True` / `False` (capitalized). */
export function showBool(value: boolean): string {
    return value ? 'True' : 'False';
}

/**
 * DAML `show` of a `Decimal` (Numeric 10): a fixed-point decimal with trailing
 * zeros stripped but always at least one fractional digit (`1.0`, `2.5`, `100.0`).
 * Accepts a string (recommended, exact) or a JS number. Rejects scientific
 * notation and more than 10 fractional digits (DAML Decimal scale).
 */
export function formatDamlDecimal(value: string | number): string {
    const raw = (typeof value === 'number' ? numberToPlainString(value) : value).trim();

    let negative = false;
    let body = raw;
    if (body.startsWith('-')) {
        negative = true;
        body = body.slice(1);
    } else if (body.startsWith('+')) {
        body = body.slice(1);
    }

    const [intPartRaw, fracPartRaw = '', ...rest] = body.split('.');
    if (rest.length > 0 || !/^\d*$/.test(intPartRaw) || !/^\d*$/.test(fracPartRaw)) {
        throw new Error(`Invalid decimal: ${raw}`);
    }
    if (fracPartRaw.length > 10) {
        throw new Error(`Decimal exceeds 10 fractional digits (DAML Decimal scale): ${raw}`);
    }

    const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
    const fracPart = fracPartRaw.replace(/0+$/, '') || '0';
    const isZero = intPart === '0' && fracPart === '0';
    return `${negative && !isZero ? '-' : ''}${intPart}.${fracPart}`;
}

function numberToPlainString(value: number): string {
    if (!Number.isFinite(value)) throw new Error(`Decimal must be finite, got ${value}`);
    // Reject exponential notation rather than guessing the intended scale.
    const asString = value.toString();
    if (/e/i.test(asString)) {
        throw new Error(`Pass decimals with many digits as strings, not numbers: ${asString}`);
    }
    return asString;
}

/**
 * Hex-encode strict-ASCII text, two lowercase hex digits per character. Rejects
 * code points >= 128: DAML encodes them as one byte while UTF-8 uses two, which
 * would produce different hashes, so non-ASCII is rejected rather than encoded
 * ambiguously (mirrors DAML `textToHex`).
 */
export function textToHex(value: string): string {
    let out = '';
    for (const char of value) {
        const cp = char.codePointAt(0)!;
        if (cp >= 128) {
            throw new Error(`Non-ASCII character (code point ${cp}) cannot be encoded`);
        }
        out += cp.toString(16).padStart(2, '0');
    }
    return out;
}

/**
 * Minimal (unpadded) lowercase hex of a non-negative integer: `0` for zero, no
 * leading zeros otherwise. Use `padLeft` on top when a fixed width is needed
 * (mirrors DAML `intToHex`).
 */
export function intToHex(value: IntLike): string {
    // `bigIntToHex` yields minimal `0x`-hex and rejects negatives; drop the prefix.
    return trim0x(bigIntToHex(toBigInt(value, 'intToHex')));
}

/**
 * Left-pad a hex string with `0` to `targetLen` characters (right-aligned, e.g.
 * uint256). Throws if `value` is already longer than `targetLen`: an oversize
 * value must be rejected, never silently kept full-length, so fixed-width fields
 * stay positionally unambiguous (mirrors DAML `padLeft`).
 */
export function padLeft(targetLen: number, value: string): string {
    if (value.length > targetLen) {
        throw new Error(`Value of length ${value.length} exceeds pad width ${targetLen}`);
    }
    return value.padStart(targetLen, '0');
}

/**
 * Assert that `value` is valid hex of exactly `expectedLen` characters (after
 * stripping an optional `0x`), returning the stripped lowercase hex. Unlike
 * padding, an off-length value is rejected rather than reshaped (mirrors DAML
 * `assertHexLength`).
 */
export function assertHexLength(expectedLen: number, value: string): string {
    const stripped = trim0x(value);
    if (stripped.length % 2 !== 0 || stripped.length === 0 || !HEX_DIGITS.test(stripped)) {
        throw new Error(`Invalid hex string: ${value}`);
    }
    if (stripped.length !== expectedLen) {
        throw new Error(`Expected ${expectedLen} hex chars, got ${stripped.length}`);
    }
    return stripped.toLowerCase();
}

/** Whole seconds since the unix epoch for a `Date` (DAML `Time` → uint256 expiry). */
export function timeToUnixSeconds(time: Date): bigint {
    return BigInt(Math.floor(time.getTime() / 1000));
}

/**
 * keccak256 of the bytes denoted by hex string `h`, returned as 64 lowercase hex
 * chars (no `0x`). `h` must be a valid hex byte string (even length, `[0-9a-fA-F]`):
 * a malformed input is rejected, never hashed as raw text, matching DAML's
 * `keccak256 : BytesHex -> BytesHex` (which aborts on a malformed encoding).
 */
export function keccak256Hex(h: string): string {
    const stripped = trim0x(h);
    if (stripped.length % 2 !== 0 || !HEX_DIGITS.test(stripped)) {
        throw new Error(`keccak256 input is not a valid hex byte string: ${h}`);
    }
    return bytesToHex(keccak_256(hexToBytes(stripped)));
}
