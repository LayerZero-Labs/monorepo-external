import type { SubtractTuple, TuplePrefixUnion } from './tuples';

// functional programming utils

type ParametersLength<T extends (...args: any[]) => any> = Parameters<T>['length'];

type BuildFn<T extends any[], R> = T extends [infer Head, ...infer Tail]
    ? (arg: Head) => BuildFn<Tail, R>
    : R;

export type Curried<T> = T extends (...args: infer Args) => infer Ret
    ? Args extends any[]
        ? BuildFn<Args, Ret>
        : T
    : T;

const _curry = (fn: (...args: any[]) => any, args: any[], remaining: number) =>
    !remaining ? fn(...args) : (arg: any) => _curry(fn, [...args, arg], remaining - 1);

export const curry = <T extends (...args: any[]) => any>(
    fn: T,
    arity: ParametersLength<T>,
): Curried<T> => _curry(fn, [], arity);

export const partiallyApply =
    <T extends (...args: any[]) => any, Args extends TuplePrefixUnion<Parameters<T>>>(
        fn: T,
        args: Args,
    ): ((...argsInner: SubtractTuple<Parameters<T>, Args>) => ReturnType<T>) =>
    (...argsInner: any[]) =>
        fn(...args, ...argsInner);

export type Uncurried<T> = T extends (...argsOuter: infer ArgsOuter) => infer RetOuter
    ? RetOuter extends (...argsInner: infer ArgsInner) => infer RetInner
        ? (argsOuter: ArgsOuter, argsInner: ArgsInner) => RetInner
        : T
    : T;

export const uncurry = <T extends (...args: any[]) => (...args: any[]) => any>(
    fn: T,
): Uncurried<T> =>
    ((argsOuter: any[], argsInner: any[]) => fn(...argsOuter)(...argsInner)) as Uncurried<T>;
