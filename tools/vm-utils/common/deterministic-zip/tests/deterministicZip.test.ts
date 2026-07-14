import { unzipSync } from 'fflate';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    zipDirectoryToBase64,
    zipDirectoryToUint8Array,
    type ZipEntryInfo,
    ZipEntryType,
} from '../src';

const testDirs: string[] = [];

const createTempDir = async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'deterministic-zip-'));
    testDirs.push(dir);
    return dir;
};

afterEach(async () => {
    await Promise.all(
        testDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
});

describe('deterministic zip', () => {
    it('sorts entries and omits empty directories', async () => {
        const dir = await createTempDir();
        await fs.mkdir(path.join(dir, 'z-empty'), { recursive: true });
        await fs.mkdir(path.join(dir, 'a'), { recursive: true });
        await fs.writeFile(path.join(dir, 'b.txt'), 'b');
        await fs.writeFile(path.join(dir, 'a', 'c.txt'), 'c');

        const unzipped = unzipSync(await zipDirectoryToUint8Array(dir));

        expect(Object.keys(unzipped)).toEqual(['a/', 'a/c.txt', 'b.txt']);
    });

    it('produces stable bytes for equivalent directories', async () => {
        const first = await createTempDir();
        const second = await createTempDir();

        await fs.mkdir(path.join(first, 'sources'), { recursive: true });
        await fs.writeFile(path.join(first, 'sources', 'module.move'), 'module first::m {}');
        await fs.writeFile(path.join(first, 'Move.toml'), '[package]\nname = "first"\n');

        await fs.writeFile(path.join(second, 'Move.toml'), '[package]\nname = "first"\n');
        await fs.mkdir(path.join(second, 'sources'), { recursive: true });
        await fs.writeFile(path.join(second, 'sources', 'module.move'), 'module first::m {}');

        expect(await zipDirectoryToBase64(first)).toEqual(await zipDirectoryToBase64(second));
    });

    it('omits directories whose files were all filtered out', async () => {
        const dir = await createTempDir();
        await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
        await fs.writeFile(path.join(dir, 'docs', 'notes.txt'), 'n');
        await fs.writeFile(path.join(dir, 'keep.txt'), 'k');

        const unzipped = unzipSync(
            await zipDirectoryToUint8Array(dir, {
                pathInclusionPredicate: ({ relPath, type }) =>
                    type === ZipEntryType.Directory || relPath === 'keep.txt',
            }),
        );

        expect(Object.keys(unzipped)).toEqual(['keep.txt']);
    });

    it('produces an empty archive when only empty directories are present', async () => {
        const dir = await createTempDir();
        await fs.mkdir(path.join(dir, 'empty'), { recursive: true });

        const unzipped = unzipSync(await zipDirectoryToUint8Array(dir));

        expect(Object.keys(unzipped)).toEqual([]);
    });

    describe('pathInclusionPredicate', () => {
        it('includes everything when no predicate is given', async () => {
            const dir = await createTempDir();
            await fs.writeFile(path.join(dir, '.env'), 'SECRET=1');
            await fs.writeFile(path.join(dir, 'id_rsa'), 'key');

            const unzipped = unzipSync(await zipDirectoryToUint8Array(dir));

            expect(Object.keys(unzipped)).toEqual(['.env', 'id_rsa']);
        });

        it('filters files through the predicate while directories remain', async () => {
            const dir = await createTempDir();
            await fs.mkdir(path.join(dir, 'sources'), { recursive: true });
            await fs.writeFile(path.join(dir, 'sources', 'module.move'), 'module a::m {}');
            await fs.writeFile(path.join(dir, 'sources', '.env'), 'SECRET=1');
            await fs.writeFile(path.join(dir, 'Move.toml'), '[package]\n');
            await fs.writeFile(path.join(dir, 'notes.txt'), 'n');

            const unzipped = unzipSync(
                await zipDirectoryToUint8Array(dir, {
                    pathInclusionPredicate: ({ relPath, type }) =>
                        type === ZipEntryType.Directory ||
                        (type === ZipEntryType.File &&
                            /(^|\/)Move\.(toml|lock)$|\.move$/.test(relPath)),
                }),
            );

            expect(Object.keys(unzipped)).toEqual(['Move.toml', 'sources/', 'sources/module.move']);
        });

        it('prunes an excluded directory subtree without visiting its children', async () => {
            const dir = await createTempDir();
            await fs.mkdir(path.join(dir, 'tests', 'nested'), { recursive: true });
            await fs.writeFile(path.join(dir, 'tests', 't.move'), 'x');
            await fs.writeFile(path.join(dir, 'tests', 'nested', 'u.move'), 'y');
            await fs.writeFile(path.join(dir, 'keep.move'), 'k');

            const seen: string[] = [];
            const unzipped = unzipSync(
                await zipDirectoryToUint8Array(dir, {
                    pathInclusionPredicate: (entry) => {
                        seen.push(entry.relPath);
                        return entry.relPath !== 'tests';
                    },
                }),
            );

            expect(Object.keys(unzipped)).toEqual(['keep.move']);
            // Children of the pruned directory are never offered to the predicate.
            expect([...seen].sort()).toEqual(['keep.move', 'tests']);
        });

        it('passes a POSIX relPath without trailing slash and the entry type', async () => {
            const dir = await createTempDir();
            await fs.mkdir(path.join(dir, 'a'), { recursive: true });
            await fs.writeFile(path.join(dir, 'a', 'b.txt'), 'b');

            const seen: ZipEntryInfo[] = [];
            await zipDirectoryToUint8Array(dir, {
                pathInclusionPredicate: (entry) => {
                    seen.push(entry);
                    return true;
                },
            });

            expect(seen).toEqual([
                { relPath: 'a', type: ZipEntryType.Directory },
                { relPath: 'a/b.txt', type: ZipEntryType.File },
            ]);
        });
    });

    describe('symlinks', () => {
        it('throws when a symlink is encountered', async () => {
            const dir = await createTempDir();
            await fs.symlink('missing-target', path.join(dir, 'link.txt'));

            await expect(zipDirectoryToUint8Array(dir)).rejects.toThrow(
                'symlink entries are not supported: link.txt',
            );
        });
    });
});
