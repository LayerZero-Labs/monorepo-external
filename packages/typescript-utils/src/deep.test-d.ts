import { expectTypeOf, test } from 'vitest';

import type { Branded } from './branded';
import type { DeepOptional } from './deep';

test('DeepOptional', () => {
    // 1 level
    type A = DeepOptional<{ a: string; b: number }>;
    expectTypeOf<A>().toEqualTypeOf<{ a?: string; b?: number }>();

    // 2 levels
    type B = DeepOptional<{ a: { c: string }; b: number }>;
    expectTypeOf<B>().toEqualTypeOf<{ a?: { c?: string }; b?: number }>();

    // 1 level with brand tag
    type obj = { a: string; b: number };
    type branded = Branded<obj, 'foo'>;
    type C = DeepOptional<branded>;
    expectTypeOf<C>().toEqualTypeOf<{ a?: string; b?: number; ___tag___: 'foo' }>();

    // 2 levels with brand tag
    type obj2 = { a: branded; b: number };
    type D = DeepOptional<Branded<obj2, 'foo2'>>;
    expectTypeOf<D>().toEqualTypeOf<{
        a?: {
            a?: string;
            b?: number;
            ___tag___: 'foo';
        };
        b?: number;
        ___tag___: 'foo2';
    }>();
});
