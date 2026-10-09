import { describe, expect, it } from 'vitest';

import { MAX_VALUE_NESTING_DEPTH } from './assert';
import { type ProtoValue, protoValueToPlain } from './protoValue';

const METHOD = 'getObject';

describe('protoValueToPlain', () => {
    it('decodes primitives', () => {
        expect(protoValueToPlain({ kind: { oneofKind: 'nullValue' } }, METHOD)).toBeNull();
        expect(
            protoValueToPlain({ kind: { oneofKind: 'numberValue', numberValue: 42 } }, METHOD),
        ).toBe(42);
        expect(
            protoValueToPlain({ kind: { oneofKind: 'stringValue', stringValue: 'hi' } }, METHOD),
        ).toBe('hi');
        expect(
            protoValueToPlain({ kind: { oneofKind: 'boolValue', boolValue: true } }, METHOD),
        ).toBe(true);
    });

    it('decodes a struct, including one with no fields', () => {
        const value: ProtoValue = {
            kind: {
                oneofKind: 'structValue',
                structValue: {
                    fields: {
                        a: { kind: { oneofKind: 'numberValue', numberValue: 1 } },
                    },
                },
            },
        };
        expect(protoValueToPlain(value, METHOD)).toEqual({ a: 1 });
        expect(
            protoValueToPlain(
                { kind: { oneofKind: 'structValue', structValue: { fields: {} } } },
                METHOD,
            ),
        ).toEqual({});
    });

    it('decodes a list, including one with no values', () => {
        const value: ProtoValue = {
            kind: {
                oneofKind: 'listValue',
                listValue: {
                    values: [
                        { kind: { oneofKind: 'numberValue', numberValue: 1 } },
                        { kind: { oneofKind: 'stringValue', stringValue: 'x' } },
                    ],
                },
            },
        };
        expect(protoValueToPlain(value, METHOD)).toEqual([1, 'x']);
        expect(
            protoValueToPlain(
                { kind: { oneofKind: 'listValue', listValue: { values: [] } } },
                METHOD,
            ),
        ).toEqual([]);
    });

    it('returns null for an undefined or empty value', () => {
        expect(protoValueToPlain(undefined, METHOD)).toBeNull();
        expect(protoValueToPlain({ kind: { oneofKind: undefined } }, METHOD)).toBeNull();
    });

    it('throws on a value nested deeper than MAX_VALUE_NESTING_DEPTH instead of overflowing the stack', () => {
        const nest = (levels: number): ProtoValue => {
            let value: ProtoValue = { kind: { oneofKind: 'numberValue', numberValue: 1 } };
            for (let i = 0; i < levels; i++) {
                value = { kind: { oneofKind: 'listValue', listValue: { values: [value] } } };
            }
            return value;
        };

        expect(() => protoValueToPlain(nest(MAX_VALUE_NESTING_DEPTH), METHOD)).not.toThrow();
        expect(() => protoValueToPlain(nest(100_000), METHOD)).toThrow(
            /^Sui gRPC compat getObject: json value nested deeper than/,
        );
    });
});
