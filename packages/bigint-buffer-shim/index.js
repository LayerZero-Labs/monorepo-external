'use strict';

const MAX_WIDTH = 1 << 16;

const asBytes = (buf) => {
    if (Object.prototype.toString.call(buf) !== '[object Uint8Array]') {
        throw new TypeError('bigint-buffer: expected a Buffer or Uint8Array');
    }
    return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
};

const hexToBigInt = (hex) => (hex.length === 0 ? 0n : BigInt(`0x${hex}`));

const toBigIntBE = (buf) => hexToBigInt(asBytes(buf).toString('hex'));

const toBigIntLE = (buf) => hexToBigInt(Buffer.from(asBytes(buf)).reverse().toString('hex'));

const toBufferBE = (num, width) => {
    if (typeof num !== 'bigint') {
        throw new TypeError('bigint-buffer: expected a bigint');
    }
    if (!Number.isSafeInteger(width) || width < 0 || width > MAX_WIDTH) {
        throw new RangeError(`bigint-buffer: width must be an integer from 0 to ${MAX_WIDTH}`);
    }
    if (num < 0n || num >> BigInt(width * 8) !== 0n) {
        throw new RangeError(`bigint-buffer: value does not fit in ${width} bytes`);
    }
    const out = Buffer.alloc(width);
    if (num === 0n) {
        return out;
    }
    const hex = num.toString(16);
    const bytes = Buffer.from(hex.length % 2 === 0 ? hex : `0${hex}`, 'hex');
    bytes.copy(out, width - bytes.length);
    return out;
};

const toBufferLE = (num, width) => toBufferBE(num, width).reverse();

exports.toBigIntLE = toBigIntLE;
exports.toBigIntBE = toBigIntBE;
exports.toBufferLE = toBufferLE;
exports.toBufferBE = toBufferBE;
