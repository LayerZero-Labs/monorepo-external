const tag = '___tag___';
/**
 * Creates a branded type of {@link T} with the brand {@link U}.
 *
 * @param T - Type to brand
 * @param U - Label
 * @returns Branded type
 *
 * @example
 * type Result = Branded<string, 'foo'>
 * //   ^? type Result = string & { [symbol]: 'foo' }
 */
export type Branded<T, U> = T & { [tag]: U };
/**
 * Represents a percentage as a decimal value. For example, 25% is represented as 0.25
 */
export type Percent = number; // Branded<number, 'percent'>

export type BrandedError<T extends string> = Branded<Error, T>;
