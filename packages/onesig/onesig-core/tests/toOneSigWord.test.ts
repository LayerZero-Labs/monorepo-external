import { describe, expect, it } from 'vitest';

import { toOneSigWord } from '../src';

const WORD = 'e3d1ec416068751cf17d01da5286c795fba37395fa56a157d8cfd87cc4fc0d40';

describe('toOneSigWord', () => {
    it('prefixes a bare Canton seed', () => {
        // Canton's OneSigConfig stores hex bare (seed == stripAndLowerHex seed).
        expect(toOneSigWord(WORD, 'seed')).toEqual(`0x${WORD}`);
    });

    it('leaves an already-prefixed value unchanged', () => {
        expect(toOneSigWord(`0x${WORD}`, 'seed')).toEqual(`0x${WORD}`);
    });

    it('lowercases uppercase hex and an uppercase 0X prefix', () => {
        expect(toOneSigWord(`0X${WORD.toUpperCase()}`, 'seed')).toEqual(`0x${WORD}`);
    });

    it('accepts a 32-byte Uint8Array', () => {
        expect(toOneSigWord(Uint8Array.from(Buffer.from(WORD, 'hex')), 'seed')).toEqual(
            `0x${WORD}`,
        );
    });

    it.each([
        ['empty', ''],
        ['0x only', '0x'],
        ['too short', '0xdeadbeef'],
        ['too long', `0x${WORD}00`],
        ['non-hex', `0x${'z'.repeat(64)}`],
    ])('rejects a %s value', (_label, value) => {
        expect(() => toOneSigWord(value, 'seed')).toThrow(
            /Expected seed to be a 32-byte hex value/,
        );
    });

    it('names the offending field in the error', () => {
        expect(() => toOneSigWord('0x00', 'merkleRoot')).toThrow(/Expected merkleRoot/);
    });
});
