import * as vitest from 'vitest';

import { parseLosslessJson, stringifyLosslessJson } from './test-helpers';

const U64_MAX = '18446744073709551615';

vitest.describe('parseLosslessJson', () => {
    vitest.it('keeps a u64 that a JS number rounds away', ({ expect }) => {
        expect(parseLosslessJson(`{"rentEpoch":${U64_MAX}}`)).toEqual({
            rentEpoch: 18446744073709551615n,
        });
        expect(JSON.parse(`{"rentEpoch":${U64_MAX}}`).rentEpoch).toBe(18446744073709552000);
    });

    vitest.it.for([
        ['safe integer', '9007199254740991', 9007199254740991],
        ['float', '1.5', 1.5],
        ['exponent past the safe range', '1e21', 1e21],
        ['zero', '0', 0],
    ])('leaves a %s a number', ([_name, literal, expected], { expect }) => {
        expect(parseLosslessJson(`{"n":${literal}}`)).toEqual({ n: expected });
    });

    vitest.it.for([
        ['first unsafe positive', '9007199254740992', 9007199254740992n],
        ['negative past the safe range', '-9007199254740993', -9007199254740993n],
    ])('converts a %s to a bigint', ([_name, literal, expected], { expect }) => {
        expect(parseLosslessJson(`{"n":${literal}}`)).toEqual({ n: expected });
    });

    vitest.it('reaches nested and array positions', ({ expect }) => {
        expect(parseLosslessJson(`{"a":{"b":[${U64_MAX}]}}`)).toEqual({
            a: { b: [18446744073709551615n] },
        });
    });
});

vitest.describe('stringifyLosslessJson', () => {
    vitest.it('round-trips a u64 unchanged', ({ expect }) => {
        const text = `{"account":{"rentEpoch":${U64_MAX}}}`;
        expect(stringifyLosslessJson(parseLosslessJson(text))).toBe(text);
    });

    vitest.it('writes bigints unquoted where JSON.stringify throws', ({ expect }) => {
        expect(stringifyLosslessJson({ n: 1n })).toBe('{"n":1}');
        expect(() => JSON.stringify({ n: 1n })).toThrow(TypeError);
    });

    vitest.it.for([
        ['an integer-shaped string', { s: '123' }, '{"s":"123"}'],
        ['a leading-zero string', { s: '007' }, '{"s":"007"}'],
        ['an integer-shaped key', { '5': 1 }, '{"5":1}'],
    ])('leaves %s quoted', ([_name, value, expected], { expect }) => {
        expect(stringifyLosslessJson(value)).toBe(expected);
    });

    vitest.it('indents spliced bigints like any other value', ({ expect }) => {
        expect(stringifyLosslessJson({ a: [{ b: 1n }] }, 2)).toBe(
            '{\n  "a": [\n    {\n      "b": 1\n    }\n  ]\n}',
        );
    });
});
