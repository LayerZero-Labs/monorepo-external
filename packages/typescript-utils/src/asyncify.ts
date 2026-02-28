export type AsyncifyDeep<T> = T extends (...args: infer A) => infer R
    ? (...args: A) => Promise<R>
    : T extends object
      ? { [K in keyof T]: AsyncifyDeep<T[K]> }
      : T;
