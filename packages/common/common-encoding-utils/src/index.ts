import bs58 from 'bs58';

import type { HexString } from '@layerzerolabs/typescript-utils';

export * from './byte-codec';
export * from './uuid';

const base58regex = /^[A-HJ-NP-Za-km-z1-9]*$/;
const base64regex = /^[A-Za-z0-9+/]*={0,2}$/;
// Lowercase `0x` prefix only: an uppercase `0X` is a manual-input error, not something any encoder
// emits, so it's rejected rather than silently accepted. (The body charset matches either case.)
const hexStringRegex = /^(0x)?[0-9A-Fa-f]*$/;

export function isBase58(address: string): boolean {
    return base58regex.test(address);
}

export function isBase64(address: string): boolean {
    return base64regex.test(address);
}

// Returns a plain boolean, not a `value is HexString` guard: the regex accepts unprefixed input
// (e.g. 'deadbeef'), so a true result does not prove the `0x` prefix HexString requires. Callers
// that need a HexString must run the value through ensure0xPrefixed.
export function isHexString(value: any, length?: number): boolean {
    if (typeof value !== 'string' || !value.match(hexStringRegex)) {
        return false;
    }
    // Measure the body, not the raw string: isHexString accepts unprefixed input, so a raw-length
    // check would assume a 2-char `0x` and reject e.g. isHexString('deadbeef', 4).
    if (length && trim0x(value).length !== 2 * length) {
        return false;
    }
    return true;
}

export function hexZeroPad(value: string, length: number): HexString {
    if (!Number.isSafeInteger(length) || length < 0) {
        // A fractional width (e.g. 1.5) produces odd-length output that hexToBytes would reject,
        // so reject it here where bigIntToHex / bigIntToBytes / numberToHex all funnel through.
        throw new Error('byteLength must be a non-negative safe integer');
    }
    if (!isHexString(value)) {
        // Length only, never the value (can be sensitive).
        throw new Error(`invalid hex string (length ${value.length})`);
    }

    // Normalize first: isHexString accepts unprefixed input, for which the `2 * length + 2`
    // check below (which assumes a 2-char `0x`) would under-count by a byte and pass overflow.
    value = ensure0xPrefixed(value);

    if (value.length > 2 * length + 2) {
        throw new Error('value out of range');
    }

    return `0x${trim0x(value).padStart(2 * length, '0')}`;
}

export function trim0x(str: string): string {
    return str.replace(/^0x/, '');
}

export function ensure0xPrefixed(str: string): HexString {
    return `0x${trim0x(str)}`;
}

export function trimLeadingZeros(hexString: string): HexString {
    // Remove the '0x' prefix
    let withoutPrefix = trim0x(hexString);

    // Trim leading zeros
    withoutPrefix = withoutPrefix.replace(/^0+/, '');

    // Add back the '0x' prefix
    return ensure0xPrefixed(withoutPrefix);
}

export function hexToAscii(hex: string): string {
    return Array.from(hexToBytes(hex), (b) => String.fromCharCode(b)).join('');
}

/** Encode a UTF-8 string to its hex representation (no `0x` prefix). */
export function utf8ToHex(value: string): string {
    return Buffer.from(value, 'utf-8').toString('hex');
}

/** Decode hex (with or without `0x`) back into a UTF-8 string. */
export function hexToUtf8(hex: string): string {
    return Buffer.from(trim0x(hex), 'hex').toString('utf-8');
}

export function stringToUint8Array(str: string): Uint8Array {
    const value = str.replace(/^0x/i, '');
    const len = value.length + 1 - ((value.length + 1) % 2);
    return Uint8Array.from(Buffer.from(value.padStart(len, '0'), 'hex'));
}

/**
 * Bytes from a `0x`-prefixed (or bare) hex string. The single canonical hex decoder.
 * Throws on non-hex and on odd-length input: a dangling half-byte is always a caller bug,
 * never silently padded or truncated.
 */
export function hexToBytes(hex: string): Uint8Array {
    if (!isHexString(hex)) {
        // Length only, never the value (sometimes a private key).
        throw new Error(`invalid hex string (length ${hex.length})`);
    }
    const body = trim0x(hex);
    if (body.length % 2 !== 0) {
        throw new Error(`hex string has an odd length (${body.length})`);
    }
    // The isHexString guard above is load-bearing: Buffer.from(_, 'hex') silently drops non-hex
    // characters, so the pure-hex check is what makes this call safe.
    return Uint8Array.from(Buffer.from(body, 'hex'));
}

// Buffer.from copies a Uint8Array but reinterprets an ArrayBuffer's bytes; normalize to bytes first.
function asUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
    return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
}

export function bytesToHex(bytes: Uint8Array | ArrayBuffer): string {
    return Buffer.from(asUint8Array(bytes)).toString('hex');
}

/**
 * 0x prefixed hex string from Uint8Array
 * @param bytes
 */
export function bytesToHexPrefixed(bytes: Uint8Array | ArrayBuffer): HexString {
    return ensure0xPrefixed(bytesToHex(bytes));
}

/**
 * Big-endian `bigint` from a hex string. Empty hex (`''` / `'0x'`) is `0n`.
 */
export function hexToBigInt(hex: string): bigint {
    if (!isHexString(hex)) {
        throw new Error(`invalid hex string (length ${hex.length})`);
    }
    const body = trim0x(hex);
    return body === '' ? 0n : BigInt(`0x${body}`);
}

/**
 * Big-endian `bigint` from bytes. Empty input is `0n`.
 */
export function bytesToBigInt(bytes: Uint8Array | ArrayBuffer): bigint {
    const hex = bytesToHex(bytes);
    return hex === '' ? 0n : BigInt(`0x${hex}`);
}

/**
 * Big-endian bytes from a non-negative `bigint`, left-padded to `byteLength`. The inverse of
 * `bytesToBigInt`. Throws on a negative value or one too wide for `byteLength`.
 */
export function bigIntToBytes(value: bigint, byteLength: number): Uint8Array {
    return hexToBytes(bigIntToHex(value, byteLength));
}

/**
 * `0x`-hex from a non-negative `bigint`, optionally left-padded to `byteLength` bytes.
 * Without `byteLength` the output is minimal and may be odd-length (e.g. `0xabc`), which
 * `hexToBytes` rejects — use `bigIntToBytes(value, byteLength)` when you need bytes.
 */
export function bigIntToHex(value: bigint, byteLength?: number): HexString {
    if (value < 0n) {
        throw new Error('cannot hex-encode a negative value');
    }
    const hex = ensure0xPrefixed(value.toString(16));
    return byteLength === undefined ? hex : hexZeroPad(hex, byteLength);
}

/**
 * `0x`-hex from a non-negative integer, optionally left-padded to `byteLength` bytes.
 */
export function numberToHex(value: number, byteLength?: number): HexString {
    // isSafeInteger (not isInteger): reject unsafe ints rather than encode a rounded value.
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('cannot hex-encode value: expected a non-negative safe integer');
    }
    return bigIntToHex(BigInt(value), byteLength);
}

/**
 * `number` from a hex string. Throws if the value exceeds `Number.MAX_SAFE_INTEGER`.
 */
export function hexToNumber(hex: string): number {
    const value = hexToBigInt(hex);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`hex value exceeds Number.MAX_SAFE_INTEGER (length ${hex.length})`);
    }
    return Number(value);
}

export function bytesToBase64(bytes: Uint8Array | ArrayBuffer): string {
    return Buffer.from(asUint8Array(bytes)).toString('base64');
}

export function base64ToBytes(base64: string): Uint8Array {
    // isBase64 checks the alphabet/padding; the length must also be a multiple of 4, or Buffer.from
    // silently drops the trailing partial group. Length only, never the value.
    if (!isBase64(base64) || base64.length % 4 !== 0) {
        throw new Error(`invalid base64 string (length ${base64.length})`);
    }
    return Uint8Array.from(Buffer.from(base64, 'base64'));
}

export function hexToBase64(hexString: string): string {
    // hexToBytes validates the input, so no separate hex check here.
    return bytesToBase64(hexToBytes(hexString));
}

export function base64ToHex(base64String: string): HexString {
    return bytesToHexPrefixed(base64ToBytes(base64String));
}

export function base58ToBytes(value: string): Uint8Array {
    if (!isBase58(value)) {
        // Length only, never the value (consistent with the hex decoders).
        throw new Error(`invalid base58 string (length ${value.length})`);
    }
    return bs58.decode(value);
}

export function bytesToBase58(bytes: Uint8Array | ArrayBuffer): string {
    return bs58.encode(asUint8Array(bytes));
}

export function base58ToHex(value: string): HexString {
    return bytesToHexPrefixed(base58ToBytes(value));
}

export function hexToBase58(hex: string): string {
    return bytesToBase58(hexToBytes(hex));
}

function padString(str: string, length: number, left: boolean, padding = '0') {
    const diff = length - str.length;
    let result = str;
    if (diff > 0) {
        const pad = padding.repeat(diff);
        result = left ? pad + str : str + pad;
    }
    return result;
}

function padLeft(str: string, length: number, padding = '0') {
    return padString(str, length, true, padding);
}
function calcByteLength(str: string, byteSize = 8) {
    const { length } = str;
    const remainder = length % byteSize;
    return remainder ? ((length - remainder) / byteSize) * byteSize + byteSize : length;
}

/**
 * Pads a hex string on the left so its length is a multiple of `byteSize`.
 * Used to align hex strings.
 * @param str Hex string.
 * @param byteSize Group size to align to, in hex chars (default: 8).
 * @param padding Left-pad character (default: '0').
 * @returns Hex string left-padded to a multiple of `byteSize`.
 */
export function padAlignHex(str: string, byteSize = 8, padding = '0') {
    const trimmed = trim0x(str);
    return padLeft(trimmed, calcByteLength(trimmed, byteSize), padding);
}
