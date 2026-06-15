import { describe, expect, test } from 'vitest';

import { parallelProcess } from '../src';

describe(`${parallelProcess.name}`, () => {
    test('processes tasks with the correct concurrency limit', async () => {
        let max = 0;
        let count = 0;
        const maxConcurrency = 2;
        const tasks = Array.from({ length: 100 }, (_, _index) => async () => {
            max = Math.max(max, ++count);
            await new Promise((r) => setTimeout(r, 20));
            count--;
        });
        await parallelProcess(tasks, maxConcurrency);
        expect(max).toEqual(2);
    });

    test('resolves with the correct results', async () => {
        const results = await parallelProcess(
            [() => Promise.resolve(1), () => Promise.resolve(2), () => Promise.resolve(3)],
            2,
        );

        expect(results).toEqual([1, 2, 3]);
    });

    test('correctly handles an error thrown in a task', async () => {
        const error = new Error('Test error');
        await expect(
            parallelProcess(
                [
                    async () => 1,
                    async () => {
                        throw error;
                    },
                ],
                2,
            ),
        ).rejects.toThrow(error);
    });
});
