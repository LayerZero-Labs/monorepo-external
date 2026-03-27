import { describe, expect, it } from 'vitest';

import { countBytes, extractBytecodeHex } from '../src/index';

describe('countBytes', () => {
    it('should return 0 for undefined', () => {
        expect(countBytes(undefined)).toBe(0);
    });

    it('should return 0 for null', () => {
        expect(countBytes(null)).toBe(0);
    });

    it('should return 0 for empty string', () => {
        expect(countBytes('')).toBe(0);
    });

    it('should return 0 for bare 0x prefix', () => {
        expect(countBytes('0x')).toBe(0);
    });

    it('should return 0 for 0x0', () => {
        expect(countBytes('0x0')).toBe(0);
    });

    it('should count bytes from a 0x-prefixed hex string', () => {
        // 4 hex chars = 2 bytes
        expect(countBytes('0xabcd')).toBe(2);
    });

    it('should count bytes from a bare hex string', () => {
        expect(countBytes('abcd')).toBe(2);
    });

    it('should ceil odd-length hex strings', () => {
        // 3 hex chars -> ceil(3/2) = 2 bytes
        expect(countBytes('0xabc')).toBe(2);
    });

    it('should handle a realistic bytecode length', () => {
        const hex = 'ab'.repeat(100); // 200 hex chars = 100 bytes
        expect(countBytes(`0x${hex}`)).toBe(100);
    });
});

describe('extractBytecodeHex', () => {
    it('should return the string as-is for plain hex strings', () => {
        expect(extractBytecodeHex('0xdeadbeef')).toBe('0xdeadbeef');
    });

    it('should extract the object property for Foundry-style bytecode', () => {
        expect(extractBytecodeHex({ object: '0xcafe' })).toBe('0xcafe');
    });

    it('should return undefined for null', () => {
        expect(extractBytecodeHex(null)).toBeUndefined();
    });

    it('should return undefined for undefined', () => {
        expect(extractBytecodeHex(undefined)).toBeUndefined();
    });

    it('should return undefined for a number', () => {
        expect(extractBytecodeHex(42)).toBeUndefined();
    });

    it('should return undefined for an object without object property', () => {
        expect(extractBytecodeHex({ foo: 'bar' })).toBeUndefined();
    });

    it('should return undefined for an object where object is not a string', () => {
        expect(extractBytecodeHex({ object: 123 })).toBeUndefined();
    });

    it('should return empty string for empty string input', () => {
        expect(extractBytecodeHex('')).toBe('');
    });
});
