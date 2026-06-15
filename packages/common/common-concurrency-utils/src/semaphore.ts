/**
 * Semaphore class for controlling access to a resource by multiple processes.
 * It maintains a counter and a queue for managing access.
 */
export class Semaphore {
    private counter = 0;
    private queue: (() => void)[] = [];
    constructor(private max: number) {}

    /**
     * Acquires a lock on the semaphore. If the semaphore is at its maximum,
     * the function will wait until it can acquire the lock.
     * @returns A promise that resolves when the lock has been acquired.
     */
    private async acquire(): Promise<void> {
        if (this.counter >= this.max) {
            await new Promise<void>((resolve) => this.queue.push(resolve));
        }
        this.counter++;
    }

    /**
     * Releases a lock on the semaphore.
     */
    private release(): void {
        if (this.counter == 0) return;
        this.counter--;
        const resolve = this.queue.shift() ?? (() => null);
        resolve();
    }

    /**
     * Executes a given asynchronous callback function, managing concurrency with semaphore locking.
     * The method ensures that the semaphore's lock is acquired before the callback is executed and released after execution.
     * It's the caller's responsibility to handle any errors within the callback.
     * @param callback - An asynchronous function to be executed. It should return a promise. The function is responsible for its own error handling.
     * @returns The promise returned by the callback function. If the callback throws, the error is not caught here and must be handled by the caller.
     */
    async process<T>(callback: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await callback();
        } finally {
            this.release();
        }
    }
}
