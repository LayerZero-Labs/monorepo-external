type IsAnyInner<T> = T extends never ? true : false;

export type IsAny<T> =
    IsAnyInner<T> extends true ? false : IsAnyInner<T> extends false ? false : true;
export type DisallowedAny<T> = IsAny<T> extends true ? never : T;
