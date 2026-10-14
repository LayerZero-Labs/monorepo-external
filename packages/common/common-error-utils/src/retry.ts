import { backOff } from 'exponential-backoff';
import type { StringValue } from 'ms';
import ms from 'ms';

export interface RetryPolicy {
    /**
     * Maximum time of a single execution attempt.
     * This timeout should be as short as the longest possible execution of the Activity body.
     *
     * @default 10 minutes
     * @format {@link https://www.npmjs.com/package/ms | ms-formatted string}
     */
    startToCloseTimeout?: StringValue;

    /**
     * Coefficient used to calculate the next retry interval.
     * The next retry interval is previous interval multiplied by this coefficient.
     * @minimum 1
     * @default 2
     */
    backoffCoefficient?: number;

    /**
     * Interval of the first retry.
     * If coefficient is 1 then it is used for all retries
     * @format {@link https://www.npmjs.com/package/ms | ms-formatted string}
     * @default 1 second
     */
    initialInterval?: StringValue;

    /**
     * Maximum number of attempts. When exceeded, retries stop.
     *
     * @default Infinity
     */
    maximumAttempts?: number;

    /**
     * Maximum interval between retries.
     * Exponential backoff leads to interval increase.
     * This value is the cap of the increase.
     *
     * @default 100x of {@link initialInterval}
     * @format {@link https://www.npmjs.com/package/ms | ms-formatted string}
     */
    maximumInterval?: StringValue;

    /**
     * List of application failures types to not retry.
     */
    nonRetryableErrorTypes?: string[];
}

/**
 * Executes a function with a retry policy.
 * @param fn - The function to execute.
 * @param policy - The retry policy to apply.
 * @param shouldRetry - A callback that determines if the error is retryable besides the nonRetryableErrorTypes.
 * @return A promise that resolves to the result of the function or rejects with an error.
 * @throws Error if the function fails after all retries.
 */
export const runWithRetryPolicy = <T = unknown>(
    fn: () => Promise<T>,
    policy?: RetryPolicy,
    shouldRetry?: (err: any) => boolean,
): Promise<T> => {
    const perTryTimeout = ms(policy?.startToCloseTimeout ?? '10 minutes');
    const numOfAttempts = policy?.maximumAttempts ?? Infinity;
    const startingDelay = ms(policy?.initialInterval ?? '1s');
    const maxDelay = policy?.maximumInterval ? ms(policy.maximumInterval) : startingDelay * 100;
    const timeMultiple = Math.max(policy?.backoffCoefficient ?? 2, 1);
    const nonRetryableErrorTypes = policy?.nonRetryableErrorTypes ?? [];

    return backOff(
        () =>
            new Promise((resolve, reject) => {
                fn().then(resolve).catch(reject);
                setTimeout(() => {
                    reject(new Error(`Execution timed out after ${perTryTimeout}ms`));
                }, perTryTimeout);
            }),
        {
            maxDelay,
            startingDelay,
            jitter: 'full',
            timeMultiple,
            numOfAttempts,
            retry: async (error: any) => {
                const errorType = error?.constructor?.name ?? error?.name;
                return (
                    !nonRetryableErrorTypes.includes(errorType) &&
                    (shouldRetry ? shouldRetry(error) : true)
                );
            },
        },
    );
};
