import type { SubtractTuple } from '@layerzerolabs/typescript-utils';
import { type TuplePrefixUnion } from '@layerzerolabs/typescript-utils';

const fpSym = Symbol('_fp_tag');
const dimSym = Symbol('_dim_tag');

export type FunctionPointer<
    Fn extends (...args: any[]) => Promise<any> = (...args: any[]) => Promise<any>,
> = {
    factoryName: string;
    dimKey: string;
    methodName: string;
    // an improper subset of the arguments expected by the method this points to
    args: any[];
} & {
    // we do it this way to preserve contravariance of the input type
    // AND to brand the pointer
    [fpSym]: Fn;
};

export type DimensionlessFunctionPointer<
    Fn extends (...args: any[]) => Promise<any> = (...args: any[]) => Promise<any>,
    Dim = any,
> = {
    factoryName: string;
    methodName: string;
    args: any[];
} & {
    [fpSym]: Fn;
    [dimSym]: Dim;
};

export type FunctionPointerUnderlying<
    Pointer extends FunctionPointer | DimensionlessFunctionPointer,
> =
    Pointer extends FunctionPointer<infer Fn>
        ? Fn
        : Pointer extends DimensionlessFunctionPointer<infer Fn>
          ? Fn
          : never;

export type FunctionPointerInput<Pointer extends FunctionPointer | DimensionlessFunctionPointer> =
    Parameters<FunctionPointerUnderlying<Pointer>>;

export type FunctionPointerOutput<Pointer extends FunctionPointer | DimensionlessFunctionPointer> =
    ReturnType<FunctionPointerUnderlying<Pointer>>;

// Does not and cannot preserve generic functions
export const partiallyApplyFunctionPointer =
    <const Pointer extends FunctionPointer>(pointer: Pointer) =>
    <const Args extends TuplePrefixUnion<FunctionPointerInput<Pointer>>>(...args: Args) =>
        ({
            ...pointer,
            args: [...pointer.args, ...args],
        }) as unknown as FunctionPointer<
            (
                ...args: SubtractTuple<FunctionPointerInput<Pointer>, Args>
            ) => FunctionPointerOutput<Pointer>
        >;

export const partiallyApplyDimensionlessFunctionPointer =
    <const Pointer extends DimensionlessFunctionPointer>(pointer: Pointer) =>
    <const Args extends TuplePrefixUnion<FunctionPointerInput<Pointer>>>(...args: Args) =>
        ({
            ...pointer,
            args: [...pointer.args, ...args],
        }) as unknown as DimensionlessFunctionPointer<
            (
                ...args: SubtractTuple<FunctionPointerInput<Pointer>, Args>
            ) => FunctionPointerOutput<Pointer>
        >;

export const isFunctionPointer = (o: any): o is FunctionPointer =>
    o.args && o.dimKey && o.factoryName && o.methodName;

export type DeepFunctionPointers<
    Fn extends (...args: any[]) => Promise<any> = (...args: any[]) => Promise<any>,
> = {
    [key: string]: DeepFunctionPointers<Fn> | FunctionPointer<Fn> | null;
};

export type DeeplyResolvedDeepFunctionPointers<Pointers extends DeepFunctionPointers> = {
    [K in keyof Pointers]: Pointers[K] extends FunctionPointer
        ? Awaited<FunctionPointerOutput<Pointers[K]>>
        : Pointers[K] extends DeepFunctionPointers
          ? DeeplyResolvedDeepFunctionPointers<Pointers[K]>
          : Pointers[K] extends null
            ? null
            : never;
};

export const deeplyResolveDeepFunctionPointers = async <
    Fn extends (...args: any[]) => Promise<any> = (...args: any[]) => Promise<any>,
>(
    deepFunctionPointers: DeepFunctionPointers<Fn>,
    resolveFunctionPointer: (pointer: FunctionPointer<Fn>) => ReturnType<Fn>,
) =>
    Object.fromEntries(
        await Promise.all(
            Object.entries(deepFunctionPointers).map(async ([k, v]): Promise<any> => {
                if (v === null) {
                    return [k, v];
                }
                // this is kind of hacky but if this case occurs we have bigger problems
                if (isFunctionPointer(v)) {
                    return [k, await resolveFunctionPointer(v as FunctionPointer<Fn>)];
                }

                return [
                    k,
                    await deeplyResolveDeepFunctionPointers(
                        v as DeepFunctionPointers<Fn>,
                        resolveFunctionPointer,
                    ),
                ];
            }),
        ),
    ) as Promise<DeeplyResolvedDeepFunctionPointers<DeepFunctionPointers<Fn>>>;
