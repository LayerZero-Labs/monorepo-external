import { rm } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

interface SafeRemoveOptions {
    maxRetries?: number;
    retryDelayMs?: number;
}

interface SafeRemoveResult {
    removed: boolean;
    error?: unknown;
}

const DEFAULT_SAFE_REMOVE_RETRYABLE_ERROR_CODES = new Set([
    'EACCES',
    'EBUSY',
    'EMFILE',
    'ENFILE',
    'ENOTEMPTY',
    'EPERM',
]);

const DEFAULT_SAFE_REMOVE_MAX_RETRIES = 3;
const DEFAULT_SAFE_REMOVE_RETRY_DELAY_MS = 100;

const getErrorCode = (error: unknown): string | undefined =>
    typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : undefined;

export const isInside = (parent: string, child: string): boolean => {
    const rel = relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

// fs.rm({ maxRetries }) does not retry EACCES, which is the Docker bind-mount cleanup
// failure seen in scoped-workspaces. Mirror Node's retry behavior and add EACCES.
export const safeRemove = async (
    path: string,
    {
        maxRetries = DEFAULT_SAFE_REMOVE_MAX_RETRIES,
        retryDelayMs = DEFAULT_SAFE_REMOVE_RETRY_DELAY_MS,
    }: SafeRemoveOptions = {},
): Promise<SafeRemoveResult> => {
    let retries = 0;

    for (;;) {
        try {
            await rm(path, { recursive: true, force: true });
            return { removed: true };
        } catch (error) {
            if (
                !DEFAULT_SAFE_REMOVE_RETRYABLE_ERROR_CODES.has(getErrorCode(error) ?? '') ||
                retries >= maxRetries
            ) {
                return { removed: false, error };
            }

            retries++;
            await delay(retries * retryDelayMs);
        }
    }
};
