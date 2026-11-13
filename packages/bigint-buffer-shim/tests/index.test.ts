import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

import * as esm from '../index.mjs';
import fixture from './fixtures/upstream-1.1.5.json';

const cjs: typeof esm = createRequire(import.meta.url)('../index.js');

const mulberry32 = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe.each([
    ['index.js (require)', cjs],
    ['index.mjs (import)', esm],
])('%s', (_entry, { toBigIntBE, toBigIntLE, toBufferBE, toBufferLE }) => {
    describe('input validation', () => {
        const notBytes: unknown[] = [
            {},
            null,
            undefined,
            123,
            1n,
            'ab',
            [1, 2],
            new Uint16Array(2),
            new DataView(new ArrayBuffer(2)),
        ];

        test.each(notBytes)('toBigIntLE/toBigIntBE reject %s', (value) => {
            expect(() => toBigIntLE(value as Uint8Array)).toThrow(TypeError);
            expect(() => toBigIntBE(value as Uint8Array)).toThrow(TypeError);
        });

        test.each([1, '1', null, undefined, 1.5])(
            'toBufferLE/toBufferBE reject non-bigint %s',
            (value) => {
                expect(() => toBufferLE(value as unknown as bigint, 8)).toThrow(TypeError);
                expect(() => toBufferBE(value as unknown as bigint, 8)).toThrow(TypeError);
            },
        );

        test.each([-1, 1.5, NaN, Infinity, 2 ** 53, (1 << 16) + 1, '8'])(
            'rejects width %s',
            (width) => {
                expect(() => toBufferLE(1n, width as number)).toThrow(RangeError);
                expect(() => toBufferBE(1n, width as number)).toThrow(RangeError);
            },
        );

        test.each([
            [-1n, 8],
            [2n ** 64n, 8],
            [0x1234n, 1],
            [1n, 0],
        ])('rejects %s at width %s instead of truncating', (num, width) => {
            expect(() => toBufferLE(num, width)).toThrow(RangeError);
            expect(() => toBufferBE(num, width)).toThrow(RangeError);
        });
    });

    describe('byte layout', () => {
        test('empty input is zero', () => {
            expect(toBigIntLE(Buffer.alloc(0))).toBe(0n);
            expect(toBigIntBE(new Uint8Array(0))).toBe(0n);
        });

        test('width 0 holds only zero', () => {
            expect(toBufferLE(0n, 0)).toEqual(Buffer.alloc(0));
            expect(toBufferBE(0n, 0)).toEqual(Buffer.alloc(0));
        });

        test('byte order', () => {
            expect(toBufferBE(0x0102n, 4).toString('hex')).toBe('00000102');
            expect(toBufferLE(0x0102n, 4).toString('hex')).toBe('02010000');
            expect(toBigIntBE(Buffer.from('0102', 'hex'))).toBe(0x0102n);
            expect(toBigIntLE(Buffer.from('0102', 'hex'))).toBe(0x0201n);
        });

        test('leading zeros and odd-length hex', () => {
            expect(toBigIntBE(Buffer.from('0000ff', 'hex'))).toBe(0xffn);
            expect(toBufferBE(0x123n, 3).toString('hex')).toBe('000123');
        });

        test('u64 bounds', () => {
            const max = 2n ** 64n - 1n;
            expect(toBufferLE(max, 8).toString('hex')).toBe('ffffffffffffffff');
            expect(toBigIntLE(toBufferLE(max, 8))).toBe(max);
        });

        test('reads only the view, not the whole backing buffer', () => {
            const backing = Buffer.from('ffff0102ffff', 'hex');
            const view = backing.subarray(2, 4);
            expect(toBigIntBE(view)).toBe(0x0102n);
            expect(toBigIntLE(view)).toBe(0x0201n);
            expect(toBigIntBE(new Uint8Array(backing.buffer, backing.byteOffset + 2, 2))).toBe(
                0x0102n,
            );
        });

        test('does not mutate its input', () => {
            const buf = Buffer.from('0102', 'hex');
            toBigIntLE(buf);
            expect(buf.toString('hex')).toBe('0102');
        });

        test('returns a Buffer of exactly width bytes', () => {
            for (const width of [0, 1, 7, 8, 32, 64]) {
                expect(Buffer.isBuffer(toBufferLE(0n, width))).toBe(true);
                expect(toBufferLE(0n, width)).toHaveLength(width);
                expect(toBufferBE(1n, Math.max(width, 1))).toHaveLength(Math.max(width, 1));
            }
        });
    });

    describe('round trips', () => {
        const rand = mulberry32(0x0b16b00b);

        test('bytes to bigint and back', () => {
            for (let i = 0; i < 2000; i++) {
                const bytes = Buffer.from(
                    Array.from({ length: Math.floor(rand() * 65) }, () => Math.floor(rand() * 256)),
                );
                expect(toBufferBE(toBigIntBE(bytes), bytes.length)).toEqual(bytes);
                expect(toBufferLE(toBigIntLE(bytes), bytes.length)).toEqual(bytes);
            }
        });
    });

    describe('matches bigint-buffer 1.1.5 on valid input', () => {
        test.each(fixture.toBigInt)('toBigInt $hex', ({ hex, le, be }) => {
            const buf = Buffer.from(hex, 'hex');
            expect(toBigIntLE(buf)).toBe(BigInt(`0x${le}`));
            expect(toBigIntBE(buf)).toBe(BigInt(`0x${be}`));
        });

        test.each(fixture.toBuffer)('toBuffer $num at width $width', ({ num, width, le, be }) => {
            expect(toBufferLE(BigInt(`0x${num}`), width).toString('hex')).toBe(le);
            expect(toBufferBE(BigInt(`0x${num}`), width).toString('hex')).toBe(be);
        });
    });
});
