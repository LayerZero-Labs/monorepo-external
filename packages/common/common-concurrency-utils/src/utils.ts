import { Semaphore } from './semaphore';

/**
 * Returns a promise that resolves to the first successful result among the provided promises.
 * If all promises reject, it rejects with an array of all errors.
 */
export async function raceToSuccess<T>(promises: Promise<T>[]): Promise<T> {
    return Promise.all(
        promises.map(async (p) => {
            return p.then(
                (val) => Promise.reject(val),
                (err) => Promise.resolve(err),
            );
        }),
    ).then(
        (errors) => Promise.reject(errors),
        (val) => Promise.resolve(val),
    );
}

/**
 * Returns a promise that resolves after the specified timeout in milliseconds.
 */
export const sleep = async (timeout: number) => new Promise((res) => setTimeout(res, timeout));

/**
 * Processes a batch of items in parallel with controlled concurrency, using a given asynchronous callback function for each item.
 * This function handles concurrency but does not catch errors from the callback functions. Errors must be handled by the caller or within the callback functions themselves.
 * @param callbacks - An array of asynchronous functions that each return a Promise. Each function should handle its own error logic.
 * @param concurrency - The maximum number of callback functions to be executed in parallel.
 * @returns A promise that resolves to an array of the resolved values of the callback functions for each item. If a callback throws, the error must be handled by the caller.
 */
export const parallelProcess = async <T>(
    callbacks: Array<() => Promise<T>>,
    concurrency: number,
): Promise<Awaited<T>[]> => {
    const semaphore = new Semaphore(concurrency);
    return Promise.all(callbacks.map((cb) => semaphore.process(cb)));
};

/**
  Parallel process that returns PromiseSettledResult instead of throwing on failure
 */
export const parallelProcessSettled = async <T>(
    callbacks: Array<() => Promise<T>>,
    concurrency: number,
): Promise<PromiseSettledResult<T>[]> => {
    const semaphore = new Semaphore(concurrency);
    return Promise.allSettled(callbacks.map((cb) => semaphore.process(cb)));
};

/**
 * The child of parallelProcess and raceToSuccess
 */
export const parallelProcessToSuccess = async <T>(
    callbacks: Array<() => Promise<T>>,
    concurrency: number,
): Promise<T> => {
    const semaphore = new Semaphore(concurrency);
    return Promise.all(
        callbacks.map((cb) =>
            semaphore.process(cb).then(
                (val) => Promise.reject(val),
                (err) => Promise.resolve(err),
            ),
        ),
    ).then(
        (errors) => Promise.reject(errors),
        (val) => Promise.resolve(val),
    );
};

/**
 * Wraps a promise with a timeout. If the promise doesn't resolve within the specified time,
 * it either throws an error or returns undefined based on the throwOnTimeout parameter.
 */
export const withTimeout = async <T, const ThrowOnTimeout extends boolean = true>(
    promise: Promise<T>,
    timeoutMs: number,
    throwOnTimeout: ThrowOnTimeout = true as any,
): Promise<ThrowOnTimeout extends true ? T : T | undefined> => {
    if (timeoutMs < 0) throw new Error(`cannot have negative timeout value: ${timeoutMs}`);
    const errorMsg = `Operation timed out after ${timeoutMs}ms`;
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(errorMsg)), timeoutMs),
    );
    const timedPromise = Promise.race([promise, timeoutPromise]);
    try {
        return await timedPromise;
    } catch (err: any) {
        if (err?.message !== errorMsg || throwOnTimeout) {
            throw err;
        }
        return undefined as any;
    }
};

/**
 * Like Promise.all but for an object of promises.
 * Resolves all values in parallel and returns an object with the same keys.
 */
export const promiseAllObj = async <T extends Record<string, any>>(
    obj: T,
): Promise<{
    [K in keyof T]: Awaited<T[K]>;
}> => {
    return Object.fromEntries(
        await Promise.all(
            Object.keys(obj).map(async (key) => {
                return [key, await obj[key]];
            }),
        ),
    );
};
