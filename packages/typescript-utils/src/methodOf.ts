export type MethodOf<T> = {
    [key in keyof T]: T[key] extends (...args: any[]) => any ? T[key] : never;
}[keyof T];

export type MethodNameOf<T> = {
    [key in keyof T]: T[key] extends (...args: any[]) => any ? key : never;
}[keyof T];
