export const isPromise = (v: unknown): v is Promise<unknown> =>
    v !== null &&
    typeof v === 'object' &&
    typeof (v as Record<string, unknown>).then === 'function' &&
    typeof (v as Record<string, unknown>).catch === 'function';
