import { copyFile, mkdir, readdir, readFile, rm } from 'fs/promises';
import { join } from 'path';

import { tryLstat } from './io';

/**
 * Make `dest` an exact copy of `src` (regular files and directories only), writing only files
 * whose bytes differ. Unchanged files keep their mtime: cargo judges path-dependency freshness by
 * source mtimes, so rewriting identical files would force a rebuild of every vendored crate and
 * everything that depends on it. Anything in `dest` that `src` lacks, or that differs in type
 * (including symlinks, which are replaced rather than written through), is removed.
 */
export const syncTree = async (src: string, dest: string): Promise<void> => {
    const destStat = await tryLstat(dest);
    if (destStat && !destStat.isDirectory()) await rm(dest, { recursive: true, force: true });

    const srcEntries = await readdir(src, { withFileTypes: true });
    const destEntries = destStat?.isDirectory() ? await readdir(dest, { withFileTypes: true }) : [];
    const srcNames = new Set(srcEntries.map((entry) => entry.name));
    const destByName = new Map(destEntries.map((entry) => [entry.name, entry]));

    await Promise.all(
        destEntries
            .filter((entry) => !srcNames.has(entry.name))
            .map((entry) => rm(join(dest, entry.name), { recursive: true, force: true })),
    );

    await mkdir(dest, { recursive: true });
    await Promise.all(
        srcEntries.map(async (srcEntry) => {
            const from = join(src, srcEntry.name);
            const to = join(dest, srcEntry.name);
            // The recursive call replaces a non-directory sitting at `to`.
            if (srcEntry.isDirectory()) return syncTree(from, to);

            const existing = destByName.get(srcEntry.name);
            if (existing?.isFile() && (await readFile(from)).equals(await readFile(to))) return;
            // Unlink first so a read-only or hard-linked copy is replaced, not written into.
            if (existing) await rm(to, { recursive: true, force: true });
            await copyFile(from, to);
        }),
    );
};
