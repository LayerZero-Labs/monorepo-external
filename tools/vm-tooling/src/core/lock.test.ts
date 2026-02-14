import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { expect, it } from 'vitest';

import { buildLockFilePath, lock } from './lock';

it('runs a callback', async () => {
    await lock('once', async () => null);
});

it('runs a callback twice', async () => {
    await lock('twice', async () => null);
    await lock('twice', async () => null);
});

it('throws an error on timeout', async () => {
    const key = 'timeout';
    const path = buildLockFilePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '');

    await expect(lock(key, async () => null, { timeout: 0 })).rejects.toThrowError(/timeout/i);

    // The `lock` function call cleans up the lock file of a bad state.
    await expect(stat(path)).rejects.toThrowError(/ENOENT/);
});
