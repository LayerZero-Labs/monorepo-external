import { backOff } from 'exponential-backoff';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { runWithRetryPolicy } from '../src/retry';

vi.mock('exponential-backoff', async (importOriginal) => {
    const originalModule = await importOriginal<typeof import('exponential-backoff')>();
    return {
        ...originalModule,
        backOff: vi.fn(originalModule.backOff),
    };
});

const mockedBackOff = vi.mocked(backOff);

describe('runWithRetryPolicy', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    test('startToCloseTimeout', async () => {
        const longRunningFn = () => new Promise(() => {}); // Never resolves

        await expect(
            runWithRetryPolicy(longRunningFn, {
                startToCloseTimeout: '50ms',
                maximumAttempts: 1,
            }),
        ).rejects.toThrow('Execution timed out after 50ms');
    });

    test('maximumAttempts', async () => {
        const failingFn = vi.fn().mockRejectedValue(new Error('simulated failure'));

        await expect(
            runWithRetryPolicy(failingFn, {
                maximumAttempts: 3,
                initialInterval: '1ms',
            }),
        ).rejects.toThrow('simulated failure');

        expect(mockedBackOff).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ numOfAttempts: 3 }),
        );
        expect(failingFn).toHaveBeenCalledTimes(3);
    });

    test('initialInterval', async () => {
        const fn = async () => {};

        await runWithRetryPolicy(fn, {
            initialInterval: '5s',
        });

        expect(mockedBackOff).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ startingDelay: 5000 }),
        );
    });

    test('maximumInterval', async () => {
        const fn = async () => {};
        await runWithRetryPolicy(fn, {
            maximumInterval: '10s',
        });
        expect(mockedBackOff).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ maxDelay: 10000 }),
        );
    });

    test('backoffCoefficient', async () => {
        const fn = async () => {};
        await runWithRetryPolicy(fn, {
            backoffCoefficient: 3,
        });
        expect(mockedBackOff).toHaveBeenCalledWith(
            expect.any(Function),
            expect.objectContaining({ timeMultiple: 3 }),
        );
    });

    test('nonRetryableErrorTypes', async () => {
        class CustomError extends Error {
            constructor(message: string) {
                super(message);
                this.name = 'CustomError';
            }
        }

        const retryableError = new Error('A retryable error');
        const nonRetryableError = new CustomError('A non-retryable error');

        const failingFn = vi
            .fn()
            .mockRejectedValueOnce(retryableError)
            .mockRejectedValueOnce(nonRetryableError);

        await expect(
            runWithRetryPolicy(failingFn, {
                maximumAttempts: 5,
                initialInterval: '1ms',
                nonRetryableErrorTypes: ['CustomError'],
            }),
        ).rejects.toThrow(nonRetryableError);

        expect(failingFn).toHaveBeenCalledTimes(2);
    });
});
