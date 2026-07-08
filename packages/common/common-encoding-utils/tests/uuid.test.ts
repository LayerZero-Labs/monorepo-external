import { describe, expect, it } from 'vitest';

import { uuidFromBytes } from '../src/uuid';

describe('uuidFromBytes', () => {
    it('formats 16 bytes as UUID v4 by default', () => {
        const bytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) bytes[i] = i;
        expect(uuidFromBytes(bytes)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    });

    it('throws on empty input', () => {
        expect(() => uuidFromBytes(new Uint8Array(0))).toThrow('uuid bytes must not be empty');
    });

    it('zero-pads when fewer than 16 bytes', () => {
        const bytes = new Uint8Array([1, 2, 3, 4, 5]);
        expect(uuidFromBytes(bytes)).toBe('01020304-0500-4000-8000-000000000000');
    });

    it('uses the first 16 bytes when input is longer', () => {
        const bytes = new Uint8Array(20);
        for (let i = 0; i < 20; i++) bytes[i] = i;
        expect(uuidFromBytes(bytes)).toBe(uuidFromBytes(bytes.subarray(0, 16)));
    });

    it('does not mutate the caller buffer', () => {
        const bytes = new Uint8Array(16).fill(0xff);
        const copy = new Uint8Array(bytes);
        uuidFromBytes(bytes);
        expect(bytes).toEqual(copy);
    });

    it('applies version 5 nibble when requested', () => {
        const bytes = new Uint8Array(16);
        for (let i = 0; i < 16; i++) bytes[i] = i;
        expect(uuidFromBytes(bytes, 5)).toBe('00010203-0405-5607-8809-0a0b0c0d0e0f');
    });
});
