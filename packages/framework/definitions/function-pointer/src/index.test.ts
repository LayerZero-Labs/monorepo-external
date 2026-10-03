import { describe, expect, test } from 'vitest';

import {
    assertFunctionPointer,
    createFunctionPointer,
    findFunctionPointers,
    FUNCTION_POINTER_MARKER,
    isFunctionPointer,
    partiallyApplyFunctionPointer,
} from '.';

const pointer = (methodName: string, args: unknown[] = []) =>
    createFunctionPointer({ factoryName: 'Factory', dimKey: '_base', methodName, args });

describe('isFunctionPointer', () => {
    test('accepts marked, well-formed pointers', () => {
        expect(isFunctionPointer(pointer('m'))).toBe(true);
    });

    test('rejects pointers without the marker', () => {
        const { [FUNCTION_POINTER_MARKER]: _, ...unmarked } = pointer('m');
        expect(isFunctionPointer(unmarked)).toBe(false);
        expect(isFunctionPointer({ ...pointer('m'), [FUNCTION_POINTER_MARKER]: 'true' })).toBe(
            false,
        );
    });

    test('rejects malformed pointers', () => {
        expect(isFunctionPointer({ ...pointer('m'), methodName: 1 })).toBe(false);
        expect(isFunctionPointer({ ...pointer('m'), args: {} })).toBe(false);
        expect(isFunctionPointer(null)).toBe(false);
        expect(isFunctionPointer('pointer')).toBe(false);
    });

    test('accepts an empty dimKey, which the registries resolve', () => {
        expect(isFunctionPointer({ ...pointer('m'), dimKey: '' })).toBe(true);
    });
});

describe('assertFunctionPointer', () => {
    test('throws on anything that is not a pointer', () => {
        expect(() => assertFunctionPointer({ factoryName: 'Factory' })).toThrow(
            /expected a function pointer/i,
        );
    });
});

describe('partiallyApplyFunctionPointer', () => {
    test('keeps the marker', () => {
        const applied = partiallyApplyFunctionPointer(
            createFunctionPointer<(a: number) => Promise<void>>({
                factoryName: 'Factory',
                dimKey: '_base',
                methodName: 'm',
            }),
        )(1);
        expect(isFunctionPointer(applied)).toBe(true);
        expect(applied.args).toEqual([1]);
    });
});

describe('findFunctionPointers', () => {
    test('finds pointers anywhere in a value', () => {
        const listen = pointer('listen');
        const fetch = pointer('fetch');
        const inArray = pointer('inArray');

        expect(
            findFunctionPointers({
                pointers: { listen, fetch },
                nested: [{ deeper: [inArray] }],
                other: 'value',
            }),
        ).toEqual([listen, fetch, inArray]);
    });

    test("finds pointers partially applied into other pointers' args", () => {
        const inner = pointer('inner');
        const outer = pointer('outer', [{ callback: inner }]);

        expect(findFunctionPointers({ outer })).toEqual([outer, inner]);
    });

    test('ignores pointer-shaped objects without the marker', () => {
        expect(
            findFunctionPointers({
                factoryName: 'Factory',
                dimKey: '_base',
                methodName: 'm',
                args: [],
            }),
        ).toEqual([]);
    });

    test('throws on marked objects that are not well-formed pointers', () => {
        expect(() =>
            findFunctionPointers({ p: { [FUNCTION_POINTER_MARKER]: false, factoryName: 'F' } }),
        ).toThrow(/expected a function pointer/i);
    });

    test('throws on cyclic values', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        expect(() => findFunctionPointers(cyclic)).toThrow(/cyclic/);
    });

    test('allows the same object to appear twice', () => {
        const shared = pointer('shared');
        expect(findFunctionPointers([shared, shared])).toEqual([shared, shared]);
    });

    test('throws on values that are too deep', () => {
        let deep: unknown = pointer('deep');
        for (let i = 0; i < 100; i++) deep = [deep];
        expect(() => findFunctionPointers(deep)).toThrow(/depth/);
    });
});
