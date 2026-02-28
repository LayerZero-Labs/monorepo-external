import type { Prettify } from './viem';

export type Merge<T, U> = {} extends T
    ? U
    : {} extends U
      ? T
      : Prettify<
            {
                [key in keyof T]: key extends keyof U ? U[key] : T[key];
            } & {
                [key in keyof U]: U[key];
            }
        >;
