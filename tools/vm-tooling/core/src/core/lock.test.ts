import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { it } from 'vitest';

import { buildLockFilePath, lock } from './lock';

it('runs a callback', async () => {
    const key = `once-${randomUUID()}`;
    await lock(key, async () => null);
});

it('runs a callback twice', async () => {
    const key = `twice-${randomUUID()}`;
    await lock(key, async () => null);
    await lock(key, async () => null);
});

it('throws an error on timeout', async ({ expect }) => {
    const key = `timeout-${randomUUID()}`;
    const path = buildLockFilePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Date.now().toString());

    await expect(lock(key, async () => null, { timeout: 1 })).rejects.toThrowError(/timeout/i);

    // The `lock` function call cleans up the lock file of a bad state.
    await expect(stat(path)).rejects.toThrowError(/ENOENT/);
});
