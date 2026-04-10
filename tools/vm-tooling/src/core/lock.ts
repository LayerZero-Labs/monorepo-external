import { delay } from 'es-toolkit';
import * as console from 'node:console';
import { rmSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { constants, mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';

interface LockOptions {
    interval?: number;
    timeout?: number;
}

const directory = join(homedir(), '.cache/vm-tooling/locks');
const defaultOptions = { interval: 1000, timeout: 15 * 60_000 };
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

export const buildLockFilePath = (key: string): string => join(directory, key);

export const lock = async <T>(key: string, run: () => Promise<T>, options: LockOptions = {}) => {
    const { interval, timeout } = { ...defaultOptions, ...options };

    const path = buildLockFilePath(key);
    const packageName = env.npm_package_name;
    const info = [...(packageName ? ['for', packageName] : []), 'at', path].join(' ');

    const unlock = () => rmSync(path, { force: true });

    while (true) {
        let lockError;

        try {
            await mkdir(directory, { recursive: true });
            const handle = await open(path, constants.O_CREAT | constants.O_EXCL);
            await handle.close();
            break;
        } catch (error: unknown) {
            lockError = error as Error;
        }

        let time: Date | undefined;

        try {
            time = (await stat(path)).birthtime;
        } catch (_error) {
            // "Crush" errors as the lock is unlocked between the `open` and `stat`.
        }

        if (time && Date.now() - time.getTime() > timeout) {
            // If the timeout is reached, we assume that the previous run is
            // in a bad state and recover automatically by removing the lock file
            // even when it is actually running still.
            unlock();
            throw new Error(`Timeout waiting for lock file ${info}: ${lockError.message}`);
        }

        await delay(interval);
    }

    for (const signal of signals) {
        process.addListener(signal, unlock);
    }

    console.log(`🔒 Acquired lock ${info}`);

    try {
        return await run();
    } finally {
        for (const signal of signals) {
            process.removeListener(signal, unlock);
        }

        unlock();

        console.log(`🔓 Released lock ${info}`);
    }
};

export const lockMany = async <T>(keys: string[], run: () => Promise<T>): Promise<T> =>
    // Sort keys to avoid deadlocks.
    keys.sort().reduce((run, key) => () => lock(key, run), run)();
