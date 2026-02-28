import type { BrandedError } from './branded';

//check that the tuple T uses every type in the union K at least once
export type IsComplete<
    T extends readonly (string | number | symbol)[],
    K extends string | number | symbol,
> = Exclude<K, T[number]> extends never ? true : false;

export type TryGetDuplicate<
    T extends readonly (string | number | symbol)[],
    Seen extends (string | number | symbol)[] = [],
> = T extends [infer Head, ...infer Tail]
    ? Head extends Seen[number]
        ? Head
        : Head extends string | number | symbol
          ? Tail extends readonly (string | number | symbol)[]
              ? TryGetDuplicate<Tail, [...Seen, Head]>
              : false
          : false
    : false;

//check that the tuple T is a valid ordering of AllKeys, using IsComplete and TryGetDuplicate
//returns a branded error if there are missing keys or duplicates
export type AssertUniqueCompleteSet<
    T extends readonly (string | number | symbol)[],
    AllKeys extends string | number | symbol,
> =
    IsComplete<T, AllKeys> extends false
        ? BrandedError<`Missing key: ${Exclude<AllKeys extends Symbol ? 'ERR' : AllKeys, T[number]>}`>
        : TryGetDuplicate<T> extends false
          ? T
          : BrandedError<`Duplicate key found: ${TryGetDuplicate<T>}`>;

type BuildTupleHelper<
    Element,
    Length extends number,
    Rest extends Element[],
> = Rest['length'] extends Length
    ? readonly [...Rest] // Terminate with readonly array (aka tuple)
    : BuildTupleHelper<Element, Length, [Element, ...Rest]>;

export type BuildTuple<Element, Length extends number> = number extends Length
    ? // Because `Length extends number` and `number extends Length`, then `Length` is not a specific finite number.
      readonly Element[] // It's not fixed length.
    : BuildTupleHelper<Element, Length, []>; // Otherwise it is a fixed length tuple.

export type TuplesToObject<T extends readonly (readonly [PropertyKey, any])[]> = {
    [K in T[number] as K[0]]: K[1];
};

export type TuplePrefixUnion<T extends any[]> =
    | []
    | (Required<T> extends [...infer Init, any] ? Required<T> | TuplePrefixUnion<Init> : never);

export type SubtractTuple<Minuend extends any[], Subtrahend extends any[]> = Subtrahend extends [
    any,
    ...infer S,
]
    ? Minuend extends [any, ...infer M]
        ? // keep subtracting
          SubtractTuple<M, S>
        : // subtrahend has a cardinality less than minuend
          never
    : // we fully subtracted already
      Minuend;
