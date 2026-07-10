/** Discovery — walk node_modules/@layerzerolabs/ to find all @layerzerolabs Cargo crates. */

import { access, readFile, stat } from 'fs/promises';
import { join } from 'path';
import { parse } from 'smol-toml';

import { logger } from '../logger';
import type { CollectedTree } from './io';
import { tryReaddir, tryRealpath } from './io';

// ─── Constants ───

/** Only packages under this npm scope are treated as Cargo dependencies. */
const LZ_SCOPE = '@layerzerolabs';

// ─── Types ───

/** A discovered package paired with its collected source tree, ready to vendor. */
export interface VendorTarget {
    /** npm package name (without scope) — the dependencies/ subdir. */
    pkgName: string;
    /** canonical source path (realpath through pnpm symlinks). */
    npmPkgDir: string;
    /** vendored location: dependencies/<pkgName>. */
    depsPkgDir: string;
    /** included file/dir tree (excluded subtrees already pruned). */
    tree: CollectedTree;
}

// ─── Crate Helpers ───

/** Checks if the directory contains a Cargo.toml. */
export const isCrate = async (dir: string): Promise<boolean> => {
    try {
        const stats = await stat(dir);
        if (!stats.isDirectory()) return false;
        await access(join(dir, 'Cargo.toml'));
        return true;
    } catch {
        return false;
    }
};

/** True if the directory's Cargo.toml declares a `[workspace]` table. */
export const isWorkspaceRoot = async (crateRoot: string): Promise<boolean> => {
    const manifestPath = join(crateRoot, 'Cargo.toml');
    let raw: string;
    try {
        raw = await readFile(manifestPath, 'utf-8');
    } catch {
        return false; // no readable Cargo.toml here — not a workspace root
    }
    try {
        return parse(raw).workspace != null;
    } catch (err) {
        // Warn rather than silently treat a malformed manifest as a non-workspace
        // (which would strip its [workspace] table); the parser is stricter than Cargo.
        logger.warn(`failed to parse ${manifestPath}; treating as non-workspace`, err);
        return false;
    }
};

// ─── Main Functions ───

/**
 * Recursively discover all @layerzerolabs Cargo packages reachable from `dir`'s node_modules.
 * Resolves pnpm symlinks to canonical paths; `visited` prevents re-walking shared deps.
 */
export const discoverPackages = async (
    dir: string,
    discovered: Map<string, string>,
    visited: Set<string>,
): Promise<void> => {
    const realDir = await tryRealpath(dir);
    if (!realDir || visited.has(realDir)) return;
    visited.add(realDir);

    const nodeModulesDir = join(dir, 'node_modules', LZ_SCOPE);

    for (const pkgName of await tryReaddir(nodeModulesDir)) {
        // Resolve pnpm symlink to canonical path (deduplicates across dep chains)
        const realPath = await tryRealpath(join(nodeModulesDir, pkgName));
        const isValidCratePath = realPath && (await isCrate(realPath));
        if (!isValidCratePath) continue;

        if (!discovered.has(pkgName)) {
            discovered.set(pkgName, realPath);
        }

        // Walk this package's own node_modules for transitive Cargo deps
        await discoverPackages(realPath, discovered, visited);
    }
};
