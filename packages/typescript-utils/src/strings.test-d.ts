import { expectTypeOf, test } from 'vitest';

import type { HexStringIsTrimmed, StringWithoutSuffix } from './strings';

test('StringWithoutSuffix', () => {
    type A = StringWithoutSuffix<'hello', 'world'>;
    expectTypeOf<A>().toBeString();

    type B = StringWithoutSuffix<'hello', 'lo'>;
    expectTypeOf<B>().toBeNever();

    // Multiple suffixes test:
    type C = StringWithoutSuffix<'hello', 'lo' | 'world'>;
    expectTypeOf<C>().toBeNever();

    type D = StringWithoutSuffix<'hello world', 'lo' | 'world'>;
    expectTypeOf<D>().toBeNever();

    type E = StringWithoutSuffix<'hello world!', 'lo' | 'world'>;
    expectTypeOf<E>().toBeString();
});

test('HexStringIsTrimmed', () => {
    type A = HexStringIsTrimmed<'0x0'>;
    expectTypeOf<A>().toExtend<true>();

    type B = HexStringIsTrimmed<'0x00'>;
    expectTypeOf<B>().toExtend<false>();

    type C = HexStringIsTrimmed<'0x'>;
    expectTypeOf<C>().toExtend<false>();
});
