import { describe, expect, it } from 'vitest';

import { isHexString, tileHex } from '../src/index';

describe('tileHex', () => {
    it('tiles a 1-byte label across a 20-byte EVM address width', () => {
        expect(tileHex('c0', 40)).toBe(`0x${'c0'.repeat(20)}`);
        expect(isHexString(tileHex('c0', 40), 20)).toBe(true);
    });

    it('tiles a multi-byte label, truncating to the target width', () => {
        expect(tileHex('c1da', 40)).toBe(`0x${'c1da'.repeat(10)}`);
        expect(isHexString(tileHex('c1da', 40), 20)).toBe(true);
    });

    it('truncates when label does not evenly divide hexLen', () => {
        expect(tileHex('abcdef', 8)).toBe('0xabcdefab');
    });

    it('tiles a 32-byte hex width for Aptos-style addresses', () => {
        expect(tileHex('c0', 64)).toBe(`0x${'c0'.repeat(32)}`);
        expect(isHexString(tileHex('c0', 64), 32)).toBe(true);
    });

    it('strips an optional 0x prefix from the label', () => {
        expect(tileHex('0xc1da', 40)).toBe(`0x${'c1da'.repeat(10)}`);
    });

    it('rejects hexLen 0', () => {
        expect(() => tileHex('c0', 0)).toThrow(/hexLen must be greater than zero/);
    });

    it('rejects empty labels', () => {
        expect(() => tileHex('', 40)).toThrow(/invalid hex label/);
        expect(() => tileHex('0x', 40)).toThrow(/invalid hex label/);
    });

    it('rejects malformed prefixed labels before trim0x', () => {
        expect(() => tileHex('0x0x', 4)).toThrow(/invalid hex label/);
        expect(() => tileHex('0x0xab', 8)).toThrow(/invalid hex label/);
    });

    it('rejects odd-length labels', () => {
        expect(() => tileHex('abc', 40)).toThrow(/invalid hex label/);
    });

    it('rejects non-hex labels', () => {
        expect(() => tileHex('zz', 40)).toThrow(/invalid hex label/);
    });

    it('rejects negative hexLen', () => {
        expect(() => tileHex('c0', -1)).toThrow(/hexLen must be a non-negative safe integer/);
    });

    it('rejects odd hexLen', () => {
        expect(() => tileHex('c0', 41)).toThrow(/hexLen must be even/);
    });
});
