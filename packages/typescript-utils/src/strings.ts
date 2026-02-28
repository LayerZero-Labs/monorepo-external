import type { Branded } from './branded';

/**
 * Guarantees that a string does not end with a suffix.
 * You can remove multiple suffixes by using a union.
 *
 * @example
 * type A = StringWithoutSuffix<'hello', 'world'>; // 'hello'
 * type B = StringWithoutSuffix<'hello', 'lo'>; // never
 * type C = StringWithoutSuffix<'hello world', 'lo' | 'world'>; // never
 */
export type StringWithoutSuffix<
    T extends string,
    Suffix extends string,
> = T extends `${infer _}${Suffix}` ? never : T;

export type HexString = `0x${string}`;

export declare const _NormalizedHexString: unique symbol;

export type NormalizedHexString = Branded<typeof _NormalizedHexString, 'NormalizedHexString'>;

/**
 * Guarantees that a hex string is trimmed.
 *
 * @example
 * type A = HexStringIsTrimmed<'0x0'>; // true
 * type B = HexStringIsTrimmed<'0x00'>; // false
 * type C = HexStringIsTrimmed<'0x'>; // false
 * type D = HexStringIsTrimmed<'0x100'>; // true
 */
export type HexStringIsTrimmed<T extends HexString> = T extends '0x0'
    ? true
    : T extends '0x'
      ? false
      : T extends `0x0${string}`
        ? false
        : true;

export declare const _NumberString: unique symbol;

export type DecimalString = Branded<typeof _NumberString, 'DecimalString'>;
