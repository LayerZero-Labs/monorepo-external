import { type Zippable, zipSync } from 'fflate';
import fs from 'node:fs/promises';
import path from 'node:path';

/** fflate deflate compression levels (0 = store, 9 = max). */
export type DeflateLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export enum ZipEntryType {
    File = 'file',
    Directory = 'directory',
}

export interface ZipEntryInfo {
    /** POSIX-relative path from the zip root, no trailing slash. */
    relPath: string;
    type: ZipEntryType;
}

export type PathInclusionPredicate = (entry: ZipEntryInfo) => boolean;

export interface ZipDirectoryOptions {
    /** Deflate compression level passed to fflate. Defaults to `6`. */
    level?: DeflateLevel;
    /** Modification time stamped onto every ZIP entry. */
    mtime?: Date;
    /**
     * Called for every file and directory. Return `false` to drop the entry;
     * `false` on a directory prunes its entire subtree (children are never
     * visited). Omitted = include everything.
     *
     * Symlinks are not supported and always throw.
     */
    pathInclusionPredicate?: PathInclusionPredicate;
}

/**
 * Fixed modification time stamped onto every archive entry.
 *
 * fflate writes ZIP timestamps from local date fields, so this value is built
 * with local fields to keep the encoded timestamp stable across timezones.
 */
export const DEFAULT_DETERMINISTIC_ZIP_MTIME = new Date(2026, 5, 15, 0, 0, 0);

const INCLUDE_EVERYTHING: PathInclusionPredicate = () => true;

type DeterministicZipEntry = { relPath: string; isDirectory: boolean };

/**
 * Drop directory entries that have no included descendant file. Empty dirs (or dirs whose files
 * were all filtered out) must not affect archive bytes / hashes.
 */
const omitEmptyDirectories = (entries: DeterministicZipEntry[]): DeterministicZipEntry[] => {
    const dirsWithFiles = new Set<string>();
    for (const entry of entries) {
        if (entry.isDirectory) continue;
        let dir = path.posix.dirname(entry.relPath);
        while (dir !== '' && dir !== '.') {
            dirsWithFiles.add(`${dir}/`);
            dir = path.posix.dirname(dir);
        }
    }
    return entries.filter((entry) => !entry.isDirectory || dirsWithFiles.has(entry.relPath));
};

/**
 * Recursively collect every included file and directory under `root`, sorted
 * by POSIX-relative path (UTF-16 code unit order). Directories with no included
 * child files are omitted.
 *
 * Filesystem `readdir` order varies by platform, so sorting is required for
 * reproducible archives.
 */
const collectSortedEntries = async (
    root: string,
    includeEntry: PathInclusionPredicate,
): Promise<DeterministicZipEntry[]> => {
    const zipEntries: DeterministicZipEntry[] = [];

    const walk = async (rel: string): Promise<void> => {
        const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
        for (const entry of entries) {
            const childRel = rel ? path.posix.join(rel, entry.name) : entry.name;
            if (entry.isDirectory()) {
                if (!includeEntry({ relPath: childRel, type: ZipEntryType.Directory })) continue;
                // fflate treats trailing-slash zero-length entries as directories.
                zipEntries.push({ relPath: `${childRel}/`, isDirectory: true });
                await walk(childRel);
            } else if (entry.isFile()) {
                if (!includeEntry({ relPath: childRel, type: ZipEntryType.File })) continue;
                zipEntries.push({ relPath: childRel, isDirectory: false });
            } else if (entry.isSymbolicLink()) {
                throw new Error(`symlink entries are not supported: ${childRel}`);
            }
        }
    };

    await walk('');
    return omitEmptyDirectories(zipEntries).sort((a, b) =>
        a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0,
    );
};

/**
 * Build a byte-deterministic ZIP of `sourceDir`.
 *
 * Entry order and timestamps are normalized so equivalent directories produce
 * stable archive bytes. Directory entries with no included child files are
 * omitted so empty folders cannot change the archive hash.
 */
export const zipDirectoryToUint8Array = async (
    sourceDir: string,
    options?: ZipDirectoryOptions,
): Promise<Uint8Array> => {
    const entries = await collectSortedEntries(
        sourceDir,
        options?.pathInclusionPredicate ?? INCLUDE_EVERYTHING,
    );
    const fileMap: Zippable = {};

    for (const entry of entries) {
        fileMap[entry.relPath] = entry.isDirectory
            ? new Uint8Array(0)
            : new Uint8Array(await fs.readFile(path.join(sourceDir, entry.relPath)));
    }

    return zipSync(fileMap, {
        level: options?.level ?? 6,
        mtime: options?.mtime ?? DEFAULT_DETERMINISTIC_ZIP_MTIME,
    });
};

export const zipDirectoryToBuffer = async (
    sourceDir: string,
    options?: ZipDirectoryOptions,
): Promise<Buffer> => Buffer.from(await zipDirectoryToUint8Array(sourceDir, options));

export const zipDirectoryToBase64 = async (
    sourceDir: string,
    options?: ZipDirectoryOptions,
): Promise<string> => (await zipDirectoryToBuffer(sourceDir, options)).toString('base64');
