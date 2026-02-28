/**
 * @description Maps the result type `R` to `R | undefined` when the input type `T` includes `undefined`,
 * preserving the undefined-ness of the input in the output type.
 *
 * @example
 * MaybeUndefinedMapped<string | undefined, number>
 * => number | undefined
 *
 * MaybeUndefinedMapped<string, number>
 * => number
 */
export type MaybeUndefinedMapped<T, R> = undefined extends T
    ? T extends undefined
        ? undefined
        : R | undefined
    : R;
