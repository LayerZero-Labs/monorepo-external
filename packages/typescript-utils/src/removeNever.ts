export type RemoveNever<T> = {
    [K in keyof T as T[K] extends never ? never : K]: T[K];
};
