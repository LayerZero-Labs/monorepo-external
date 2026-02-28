export type IntersectionValueOf<T> = (
    T[keyof T] extends infer U ? (U extends any ? (x: U) => void : never) : never
) extends (x: infer I) => void
    ? I
    : never;

/**
 * @description Creates a type that extracts the values of T.
 *
 * @example
 * ValueOf<{ a: string, b: number }>
 * => string | number
 *
 * @internal
 */
export type ValueOf<T> = T[keyof T];
