export type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

export type AllRequired<T> = {
    [K in keyof T]-?: T[K];
};
