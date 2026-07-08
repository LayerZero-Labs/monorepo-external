/**
 * Growable byte codec backed by `ArrayBuffer` + `DataView`.
 *
 * Low-level building block for constructing byte payloads deterministically.
 * Higher-level concerns (e.g. hashing, ABI encoding, function signatures) should
 * live in wrappers/subclasses.
 */

function uMax(bits: number): bigint {
    if (!Number.isInteger(bits) || bits < 0) {
        throw new RangeError(`ByteCodec: invalid bit width: ${bits}`);
    }
    // (2^bits) - 1, as bigint
    return bits === 0 ? 0n : (1n << BigInt(bits)) - 1n;
}

// TODO: add tests for this class — currently has zero test coverage
export class ByteCodec {
    // Start with a small-ish initial capacity to avoid frequent reallocations for
    // common short payloads (e.g. function selector + a few fixed-width fields),
    // while still staying tiny in memory terms. Buffer grows by doubling as needed.
    #buf = new ArrayBuffer(128);
    #view = new DataView(this.#buf);
    #cursor = 0;

    static readonly #ZERO = 0n;
    static readonly #U8_MAX = uMax(8);
    static readonly #U16_MAX = uMax(16);
    static readonly #U32_MAX = uMax(32);
    static readonly #U64_MAX = uMax(64);
    static readonly #U128_MAX = uMax(128);
    static readonly #U256_MAX = uMax(256);

    static #outOfRange(targetLength: number, value: bigint): RangeError {
        return new RangeError(`ByteCodec: value out of range for u${targetLength * 8}: ${value}`);
    }

    /**
     * Read helpers (big-endian). These are intentionally small/low-level so other
     * packages can share a single implementation for parsing encoded payloads.
     */
    static readU16be(buf: Uint8Array, offset: number): number {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        return view.getUint16(offset, false);
    }

    static readU8(buf: Uint8Array, offset: number): number {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        return view.getUint8(offset);
    }

    static readU32be(buf: Uint8Array, offset: number): number {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        return view.getUint32(offset, false);
    }

    static readU128be(buf: Uint8Array, offset: number): bigint {
        return ByteCodec.readUNbe(buf, offset, 16);
    }

    static readUNbe(buf: Uint8Array, offset: number, length: number): bigint {
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

        let out = 0n;
        const end = offset + length;

        // Fast path: read 8 bytes at a time
        let cursor = offset;
        while (cursor + 8 <= end) {
            out = (out << 64n) | view.getBigUint64(cursor, false);
            cursor += 8;
        }

        // Tail: 0..7 bytes
        while (cursor < end) {
            out = (out << 8n) | BigInt(view.getUint8(cursor));
            cursor += 1;
        }

        return out;
    }

    static readBytes32(buf: Uint8Array, offset: number): Uint8Array {
        if (offset + 32 > buf.length) throw new RangeError(`ByteCodec: out of bounds at ${offset}`);
        return buf.slice(offset, offset + 32);
    }

    /**
     * Left-pad `bytes` to `targetLength` using `padByte` (default 0x00).
     *
     * Commonly used to mimic Solidity's `bytes32(bytesN)`-style left zero padding.
     */
    static leftPad(bytes: Uint8Array, targetLength: number, padByte = 0): Uint8Array {
        if (!Number.isInteger(targetLength) || targetLength < 0) {
            throw new RangeError(`ByteCodec: invalid length: target=${targetLength}`);
        }
        if (!Number.isInteger(padByte) || padByte < 0 || padByte > 255) {
            throw new RangeError(`ByteCodec: invalid pad byte: ${padByte}`);
        }
        if (bytes.length > targetLength) {
            throw new RangeError(
                `ByteCodec: bytes length ${bytes.length} exceeds target ${targetLength}`,
            );
        }

        const out = new Uint8Array(targetLength);
        if (padByte !== 0) out.fill(padByte);
        out.set(bytes, targetLength - bytes.length);
        return out;
    }

    /**
     * Cast an unsigned big-endian integer in `bytes` into a fixed-width uint (by bytes),
     * reverting on overflow.
     *
     * This mirrors Solidity-style safe casts like `SafeCast.toUint128(uint256)`:
     * - if `bytes.length > targetLength`, the high (bytes.length - targetLength) bytes must be all zero
     * - returns the low `targetLength` bytes as the result
     *
     * Examples:
     * - cast bytes32 -> u128: castUNbe(bytes32, 16)
     * - cast bytesN -> u64:   castUNbe(bytesN, 8)
     */
    static castUNbe(bytes: Uint8Array, targetLength: number): bigint {
        if (!Number.isInteger(targetLength) || targetLength < 0) {
            throw new RangeError(`ByteCodec: invalid length: target=${targetLength}`);
        }

        const len = bytes.length;
        if (len <= targetLength) return ByteCodec.readUNbe(bytes, 0, len);

        // Overflow check: any excess high bytes must be 0x00.
        const excess = len - targetLength;
        for (let i = 0; i < excess; i++) {
            if (bytes[i] !== 0)
                throw ByteCodec.#outOfRange(targetLength, ByteCodec.readUNbe(bytes, 0, len));
        }

        return ByteCodec.readUNbe(bytes, excess, targetLength);
    }

    static castU8be(bytes: Uint8Array): bigint {
        return ByteCodec.castUNbe(bytes, 1);
    }

    static castU16be(bytes: Uint8Array): bigint {
        return ByteCodec.castUNbe(bytes, 2);
    }

    static castU32be(bytes: Uint8Array): bigint {
        return ByteCodec.castUNbe(bytes, 4);
    }

    static castU64be(bytes: Uint8Array): bigint {
        return ByteCodec.castUNbe(bytes, 8);
    }

    static castU128be(bytes: Uint8Array): bigint {
        return ByteCodec.castUNbe(bytes, 16);
    }

    protected ensureCapacity(additionalBytes: number): void {
        const needed = this.#cursor + additionalBytes;
        if (needed <= this.#buf.byteLength) return;

        let nextCap = this.#buf.byteLength;
        while (nextCap < needed) nextCap *= 2;

        // Grow by allocating a new ArrayBuffer and copying the written prefix
        // [0..cursor) into it. We then swap the backing buffer+view.
        const next = new ArrayBuffer(nextCap);
        new Uint8Array(next).set(new Uint8Array(this.#buf, 0, this.#cursor));
        this.#buf = next;
        this.#view = new DataView(this.#buf);
    }

    bytes(b: Uint8Array): this {
        this.ensureCapacity(b.length);
        new Uint8Array(this.#buf, this.#cursor, b.length).set(b);
        this.#cursor += b.length;
        return this;
    }

    bytes32(b: Uint8Array): this {
        return this.bytes(ByteCodec.leftPad(b, 32));
    }

    bool(b: boolean): this {
        return this.u8(b ? 1n : ByteCodec.#ZERO);
    }

    u8(v: bigint): this {
        if (v < ByteCodec.#ZERO || v > ByteCodec.#U8_MAX)
            throw new RangeError(`ByteCodec: value out of range for u8: ${v}`);
        this.ensureCapacity(1);
        this.#view.setUint8(this.#cursor, Number(v));
        this.#cursor += 1;
        return this;
    }

    u16be(v: bigint): this {
        if (v < ByteCodec.#ZERO || v > ByteCodec.#U16_MAX)
            throw new RangeError(`ByteCodec: value out of range for u16: ${v}`);
        this.ensureCapacity(2);
        this.#view.setUint16(this.#cursor, Number(v), false);
        this.#cursor += 2;
        return this;
    }

    u32be(v: bigint): this {
        if (v < ByteCodec.#ZERO || v > ByteCodec.#U32_MAX) {
            throw new RangeError(`ByteCodec: value out of range for u32: ${v}`);
        }
        this.ensureCapacity(4);
        this.#view.setUint32(this.#cursor, Number(v), false);
        this.#cursor += 4;
        return this;
    }

    u64be(v: bigint): this {
        if (v < ByteCodec.#ZERO || v > ByteCodec.#U64_MAX) {
            throw new RangeError(`ByteCodec: value out of range for u64: ${v}`);
        }
        this.ensureCapacity(8);
        this.#view.setBigUint64(this.#cursor, v, false);
        this.#cursor += 8;
        return this;
    }

    u128be(v: bigint): this {
        if (v < ByteCodec.#ZERO || v > ByteCodec.#U128_MAX) {
            throw new RangeError(`ByteCodec: value out of range for u128: ${v}`);
        }
        this.ensureCapacity(16);
        const hi = (v >> 64n) & ByteCodec.#U64_MAX;
        const lo = v & ByteCodec.#U64_MAX;
        this.#view.setBigUint64(this.#cursor, hi, false);
        this.#view.setBigUint64(this.#cursor + 8, lo, false);
        this.#cursor += 16;
        return this;
    }

    u256be(v: bigint): this {
        if (v < ByteCodec.#ZERO || v > ByteCodec.#U256_MAX) {
            throw new RangeError(`ByteCodec: value out of range for u256: ${v}`);
        }
        this.ensureCapacity(32);
        const w0 = (v >> 192n) & ByteCodec.#U64_MAX;
        const w1 = (v >> 128n) & ByteCodec.#U64_MAX;
        const w2 = (v >> 64n) & ByteCodec.#U64_MAX;
        const w3 = v & ByteCodec.#U64_MAX;
        this.#view.setBigUint64(this.#cursor, w0, false);
        this.#view.setBigUint64(this.#cursor + 8, w1, false);
        this.#view.setBigUint64(this.#cursor + 16, w2, false);
        this.#view.setBigUint64(this.#cursor + 24, w3, false);
        this.#cursor += 32;
        return this;
    }
    /**
     * Returns a copy of the accumulated bytes (no shared backing buffer).
     */
    toBytes(): Uint8Array {
        return new Uint8Array(this.#buf, 0, this.#cursor).slice();
    }
}
