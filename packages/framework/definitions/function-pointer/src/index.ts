import type { SubtractTuple } from '@layerzerolabs/typescript-utils';
import { type TuplePrefixUnion } from '@layerzerolabs/typescript-utils';

const fpSym = Symbol('_fp_tag');
const dimSym = Symbol('_dim_tag');

// this is the runtime equivalent of the `fpSym` brand, it's exported so that it can be used for runtime validation
export const FUNCTION_POINTER_MARKER = '__IS_FUNCTION_POINTER' as const;

export type FunctionPointer<
    Fn extends (...args: any[]) => Promise<any> = (...args: any[]) => Promise<any>,
> = {
    [FUNCTION_POINTER_MARKER]: true;
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
    [FUNCTION_POINTER_MARKER]: true;
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

export const createFunctionPointer = <
    Fn extends (...args: any[]) => Promise<any> = (...args: any[]) => Promise<any>,
>({
    factoryName,
    dimKey,
    methodName,
    args = [],
}: {
    factoryName: string;
    dimKey: string;
    methodName: string;
    args?: any[];
}): FunctionPointer<Fn> =>
    ({
        [FUNCTION_POINTER_MARKER]: true,
        factoryName,
        dimKey,
        methodName,
        args,
    }) as FunctionPointer<Fn>;

export const isFunctionPointer = (o: unknown): o is FunctionPointer => {
    if (typeof o !== 'object' || o === null) return false;
    const {
        [FUNCTION_POINTER_MARKER]: marker,
        factoryName,
        dimKey,
        methodName,
        args,
    } = o as Record<string, unknown>;
    return (
        marker === true &&
        typeof factoryName === 'string' &&
        typeof dimKey === 'string' &&
        typeof methodName === 'string' &&
        Array.isArray(args)
    );
};

const describeValue = (o: unknown) => {
    try {
        return JSON.stringify(o).slice(0, 200);
    } catch {
        return String(o);
    }
};

export function assertFunctionPointer(o: unknown): asserts o is FunctionPointer {
    if (!isFunctionPointer(o)) {
        throw new Error(`Expected a function pointer, got ${describeValue(o)}`);
    }
}

const MAX_FUNCTION_POINTER_SEARCH_DEPTH = 64;

/**
 * Finds every function pointer in POD, including pointers partially applied
 * @throws on malformed pointers, or the value is cyclic or too deep
 */
export const findFunctionPointers = (value: unknown): FunctionPointer[] => {
    const pointers: FunctionPointer[] = [];
    const ancestors = new Set<object>();

    const visit = (v: unknown, depth: number) => {
        if (typeof v !== 'object' || v === null) return;
        if (depth > MAX_FUNCTION_POINTER_SEARCH_DEPTH) {
            throw new Error(
                `Exceeded depth ${MAX_FUNCTION_POINTER_SEARCH_DEPTH} while searching for function pointers`,
            );
        }
        if (ancestors.has(v)) {
            throw new Error('Cannot search a cyclic value for function pointers');
        }

        if (FUNCTION_POINTER_MARKER in v) {
            assertFunctionPointer(v);
            pointers.push(v);
        }

        ancestors.add(v);
        for (const child of Object.values(v)) {
            visit(child, depth + 1);
        }
        ancestors.delete(v);
    };

    visit(value, 0);
    return pointers;
};

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
