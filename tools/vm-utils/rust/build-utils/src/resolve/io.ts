import { readdir, realpath, stat } from 'fs/promises';
import { basename, dirname, extname, join } from 'path';

import { logger } from '../logger';
import { COPY_EXTENSIONS, removeExcludedFiles } from './exclude';

export const tryRealpath = async (path: string): Promise<string | undefined> => {
    try {
        return await realpath(path);
    } catch {
        return undefined;
    }
};

export const tryIsDirectory = async (path: string): Promise<boolean> => {
    try {
        return (await stat(path)).isDirectory();
    } catch {
        return false;
    }
};

export const tryReaddir = async (dir: string): Promise<string[]> => {
    try {
        return await readdir(dir);
    } catch {
        return [];
    }
};

export interface CollectedTree {
    /** directories containing copyable content, relative to root (no empties) */
    dirs: string[];
    /** copyable files (COPY_EXTENSIONS), relative to root (excluded subtrees pruned) */
    files: string[];
    /** dirs that directly contain a Cargo.toml (crate roots), relative to root; '.' is the root */
    manifestDirs: string[];
}

/**
 * Walk `root` once, applying exclusion per level and keeping only COPY_EXTENSIONS files.
 * Also records `manifestDirs` (dirs holding a Cargo.toml) so consumers don't re-scan.
 */
export const collectFiles = async (root: string, relativePath = ''): Promise<CollectedTree> => {
    const dirs: string[] = [];
    const files: string[] = [];
    const manifestDirs: string[] = [];

    const rawFileNames = await tryReaddir(join(root, relativePath));
    const fileNames = removeExcludedFiles(rawFileNames).map((e) => join(relativePath, e));

    for (const file of fileNames) {
        if (await tryIsDirectory(join(root, file))) {
            const subDir = await collectFiles(root, file);
            if (subDir.files.length > 0) {
                dirs.push(file, ...subDir.dirs);
                files.push(...subDir.files);
                manifestDirs.push(...subDir.manifestDirs);
            } else {
                logger.trace(`skip empty dir ${file}`);
            }
        } else if (COPY_EXTENSIONS.has(extname(file))) {
            files.push(file);
            if (basename(file) === 'Cargo.toml') manifestDirs.push(dirname(file));
            logger.trace(`collect ${file}`);
        }
    }
    return { dirs, files, manifestDirs };
};
