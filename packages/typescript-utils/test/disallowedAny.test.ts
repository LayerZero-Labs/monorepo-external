import { describe, expectTypeOf, it } from 'vitest';

import type { DisallowedAny } from '../src/disallowedAny';

describe('DisallowedAny type utility', () => {
    it('disallows bare any', () => {
        type R = DisallowedAny<any>;
        expectTypeOf<R>().toEqualTypeOf<never>();
    });

    it('passes through primitives', () => {
        expectTypeOf<DisallowedAny<string>>().toEqualTypeOf<string>();
        expectTypeOf<DisallowedAny<number>>().toEqualTypeOf<number>();
        expectTypeOf<DisallowedAny<boolean>>().toEqualTypeOf<boolean>();
        expectTypeOf<DisallowedAny<symbol>>().toEqualTypeOf<symbol>();
        expectTypeOf<DisallowedAny<bigint>>().toEqualTypeOf<bigint>();
        expectTypeOf<DisallowedAny<null>>().toEqualTypeOf<null>();
        expectTypeOf<DisallowedAny<undefined>>().toEqualTypeOf<undefined>();
    });

    it('does not treat unknown as any', () => {
        expectTypeOf<DisallowedAny<unknown>>().toEqualTypeOf<unknown>();
    });

    it('disallows unions that include any (any absorbs the union)', () => {
        type U1 = DisallowedAny<any | string>;
        expectTypeOf<U1>().toEqualTypeOf<never>();

        type U2 = DisallowedAny<string | number>;
        expectTypeOf<U2>().toEqualTypeOf<string | number>();
    });

    it('disallows intersections that include any (any absorbs the intersection)', () => {
        type I1 = DisallowedAny<any & { a: 1 }>;
        expectTypeOf<I1>().toEqualTypeOf<never>();
    });

    it('works with generics: when T is any it becomes never; otherwise it passes through', () => {
        type Wrap<T> = DisallowedAny<T>;

        type G1 = Wrap<any>;
        expectTypeOf<G1>().toEqualTypeOf<never>();

        type G2 = Wrap<{ x: string }>; // non-any generic
        expectTypeOf<G2>().toEqualTypeOf<{ x: string }>();
    });

    it('allows type constraints', () => {
        const myFunc = <T extends number>(_: DisallowedAny<T>): void => {};
        myFunc(5);
        //@ts-expect-error
        myFunc(5 as any);
    });
});
