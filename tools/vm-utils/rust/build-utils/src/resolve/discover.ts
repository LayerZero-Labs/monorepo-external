/** Discovery — walk node_modules/@layerzerolabs/ to find all @layerzerolabs Cargo crates. */

import { access, readFile, stat } from 'fs/promises';
import { dirname, join } from 'path';
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
 * Recursively discover all @layerzerolabs Cargo packages reachable from `dir`: everything in its
 * node_modules, plus the @layerzerolabs packages its package.json declares as dependencies.
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
        await addCrate(
            pkgName,
            await tryRealpath(join(nodeModulesDir, pkgName)),
            discovered,
            visited,
        );
    }

    // Outside a workspace (e.g. pnpm's default layout for registry installs), a package's own
    // dependencies are not in its node_modules but beside it, so look them up the way Node does.
    for (const name of await declaredDependencies(realDir)) {
        await addCrate(name, await findInstalled(realDir, name), discovered, visited);
    }
};

const addCrate = async (
    pkgName: string,
    realPath: string | undefined,
    discovered: Map<string, string>,
    visited: Set<string>,
): Promise<void> => {
    if (!realPath || !(await isCrate(realPath))) return;
    const existing = discovered.get(pkgName);
    if (existing === undefined) {
        discovered.set(pkgName, realPath);
    } else if (existing !== realPath) {
        // Crates are vendored by name, so only one copy can win.
        logger.warn(
            `${LZ_SCOPE}/${pkgName} is installed at two paths; using ${existing}, ignoring ${realPath}`,
        );
    }
    await discoverPackages(realPath, discovered, visited);
};

/** Unscoped names of the @layerzerolabs packages in `dir`'s package.json `dependencies`. */
const declaredDependencies = async (dir: string): Promise<string[]> => {
    try {
        const { dependencies = {} } = JSON.parse(
            await readFile(join(dir, 'package.json'), 'utf-8'),
        );
        return Object.keys(dependencies)
            .filter((name) => name.startsWith(`${LZ_SCOPE}/`))
            .map((name) => name.slice(LZ_SCOPE.length + 1));
    } catch {
        return [];
    }
};

/** Node module resolution: the first `node_modules/@layerzerolabs/<pkgName>` from `dir` upwards. */
const findInstalled = async (dir: string, pkgName: string): Promise<string | undefined> => {
    for (let current = dir; ; current = dirname(current)) {
        const found = await tryRealpath(join(current, 'node_modules', LZ_SCOPE, pkgName));
        if (found || dirname(current) === current) return found;
    }
};
