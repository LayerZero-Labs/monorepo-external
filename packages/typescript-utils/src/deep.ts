import type { Prettify } from './viem';

/**
 * Copy the brand tag from the branded.ts file, can't import it to keep it hidden from library users
 */
const brandTag = '___tag___';

export type DeepRequire<T> = {
    [P in keyof T]-?: DeepRequire<T[P]>;
};

export type DeepOptional<T> = T extends { [brandTag]: infer V }
    ? Prettify<
          { [brandTag]: V } & {
              [P in keyof T]?: DeepOptional<T[P]>;
          }
      >
    : {
          [P in keyof T]?: DeepOptional<T[P]>;
      };

export type DeepUnion<T, U> =
    | {
          [P in keyof T]: DeepUnion<T[P], U>;
      }
    | U;
