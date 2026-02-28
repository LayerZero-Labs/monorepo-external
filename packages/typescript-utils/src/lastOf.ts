export type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (
    k: infer I,
) => void
    ? I
    : never;

export type LastOf<T> =
    UnionToIntersection<T extends any ? () => T : never> extends () => infer R ? R : never;

type Prepend<T, U extends any[]> = [T, ...U];

export type UnionToArray<T, U extends any[] = []> =
    LastOf<T> extends never ? U : UnionToArray<Exclude<T, LastOf<T>>, Prepend<LastOf<T>, U>>;

export type RestOf<T> = Exclude<T, LastOf<T>>;
