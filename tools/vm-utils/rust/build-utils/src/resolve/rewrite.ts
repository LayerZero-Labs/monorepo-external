/**
 * Rewrite a vendored Cargo.toml's path deps into the flat dependencies/ layout,
 * operating on the parsed TOML (via smol-toml) rather than text.
 */

import { readFile, writeFile } from 'fs/promises';
import { dirname, join, relative } from 'path';
import { parse, stringify } from 'smol-toml';

import { logger } from '../logger';
import { isWorkspaceRoot } from './discover';
import { hasExcludedSegment } from './exclude';
import { type CollectedTree, tryRealpath } from './io';

/** Bundled resolution state passed through the rewrite pipeline. */
export interface RewriteContext {
    pathMap: Map<string, string>;
    discovered: Map<string, string>;
}

type Table = Record<string, unknown>;

/** A dependency spec that carries a `path` — an inline table like `{ path = "…" }`. */
type PathDepSpec = Table & { path: string };

const isTable = (value: unknown): value is Table =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const DEP_TABLE_KEYS = ['dependencies', 'dev-dependencies', 'build-dependencies'] as const;

/**
 * Dependency specs that declare a `path`, across every dependency table (plus
 * `[workspace.dependencies]` when `includeWorkspaceDeps`). Specs are live references
 * into `manifest`, so mutating `.path` updates it.
 */
const pathDepSpecs = (manifest: Table, includeWorkspaceDeps: boolean): PathDepSpec[] => {
    // The root manifest and each [target.'cfg(...)'] table both hold DEP_TABLE_KEYS tables.
    const containers = [
        manifest,
        ...(isTable(manifest.target) ? Object.values(manifest.target).filter(isTable) : []),
    ];

    const depTables = [
        ...containers.flatMap((container) => DEP_TABLE_KEYS.map((key) => container[key])),
        ...(includeWorkspaceDeps && isTable(manifest.workspace)
            ? [manifest.workspace.dependencies]
            : []),
    ];

    return depTables
        .filter(isTable)
        .flatMap((table) => Object.values(table))
        .filter((spec): spec is PathDepSpec => isTable(spec) && typeof spec.path === 'string');
};

/**
 * Drop literal `members` / `default-members` entries whose path contains an excluded
 * directory segment (e.g. `tests/mock_vault`) — those dirs are never vendored, so the
 * member would dangle and fail Cargo's workspace load. Globs (`tests/*`) are kept; Cargo
 * re-expands them to a harmless empty match. Returns true if any member was removed.
 */
export const pruneExcludedLiteralMembers = (manifest: Table): boolean => {
    const workspace = manifest.workspace;
    if (!isTable(workspace)) return false;

    let changed = false;
    for (const key of ['members', 'default-members'] as const) {
        const members = workspace[key];
        if (!Array.isArray(members)) continue;

        // Keep everything except literal (non-glob) members inside an excluded dir.
        const kept = members.filter(
            (m) => typeof m !== 'string' || m.includes('*') || !hasExcludedSegment(m),
        );

        if (kept.length !== members.length) {
            workspace[key] = kept;
            changed = true;
        }
    }
    return changed;
};

/** Rebase every path dep in `manifest` into the flat dependencies/ layout. Returns true if any changed. */
export const rewritePathDeps = async (
    manifest: Table,
    originalDir: string,
    manifestDir: string,
    ctx: RewriteContext,
    includeWorkspaceDeps: boolean,
): Promise<boolean> => {
    let changed = false;
    for (const spec of pathDepSpecs(manifest, includeWorkspaceDeps)) {
        const target =
            (await resolveViaRealpath(originalDir, spec.path, ctx.pathMap)) ??
            resolveViaNameFallback(spec.path, ctx);
        if (!target) continue;

        const rewritten = relative(manifestDir, target);
        if (rewritten === spec.path) continue;

        logger.trace(`rewrite path dep ${spec.path} -> ${rewritten}`);
        spec.path = rewritten;
        changed = true;
    }

    return changed;
};

/**
 * Delete the `[workspace]` / `[patch.*]` / `[profile.*]` tables — invalid or ignored in a
 * vendored dependency (only honored at the real workspace root). Returns true if any was removed.
 */
export const stripRootOnlyTables = (manifest: Table): boolean => {
    let changed = false;
    for (const table of ['workspace', 'patch', 'profile'] as const) {
        if (manifest[table] != null) {
            delete manifest[table];
            changed = true;
        }
    }
    return changed;
};

/**
 * Rewrite one vendored Cargo.toml in place: rebase its path deps, then strip the root-only
 * tables — or, for a preserved workspace root (`stripRootTables = false`), prune excluded
 * members instead. Re-serialized only if something changed.
 *
 * @param originalDir    source crate dir the manifest was copied from
 * @param cargoTomlPath  the vendored Cargo.toml to rewrite
 */
export const rewriteCargoToml = async (
    originalDir: string,
    cargoTomlPath: string,
    ctx: RewriteContext,
    stripRootTables = true,
): Promise<void> => {
    const manifest = parse(await readFile(cargoTomlPath, 'utf-8'));

    const pathsChanged = await rewritePathDeps(
        manifest,
        originalDir,
        dirname(cargoTomlPath),
        ctx,
        !stripRootTables,
    );

    const tablesChanged = stripRootTables
        ? stripRootOnlyTables(manifest)
        : pruneExcludedLiteralMembers(manifest);

    if (pathsChanged || tablesChanged) {
        await writeFile(cargoTomlPath, stringify(manifest));
        logger.debug(`rewrote ${cargoTomlPath}`);
    }
};

/** Primary resolution: realpath the path through pnpm symlinks, then look it up in pathMap. */
const resolveViaRealpath = async (
    originalDir: string,
    pathValue: string,
    pathMap: Map<string, string>,
): Promise<string | undefined> => {
    const resolvedPath = await tryRealpath(join(originalDir, pathValue));
    return resolvedPath ? pathMap.get(resolvedPath) : undefined;
};

/**
 * Fallback: locate a discovered npm package stem in the path and preserve every
 * suffix segment after it (e.g. protocol-stellar-v2/message-libs/simple-message-lib).
 *
 * When several discovered package names appear as path segments, pick the
 * **rightmost** (deepest) match — insertion order must not win over specificity.
 */
const resolveViaNameFallback = (pathValue: string, ctx: RewriteContext): string | undefined => {
    const segments = pathValue.split('/').filter(Boolean);
    if (segments.length === 0) return undefined;

    let best:
        | {
              pkgIndex: number;
              vendoredBase: string;
              suffixSegments: string[];
          }
        | undefined;

    for (const [pkgName, realPath] of ctx.discovered) {
        const pkgIndex = segments.indexOf(pkgName);
        if (pkgIndex === -1) continue;

        const vendoredBase = ctx.pathMap.get(realPath);
        if (!vendoredBase) continue;

        // Prefer the deepest stem. Equal index cannot happen for distinct names.
        if (best != null && pkgIndex <= best.pkgIndex) continue;

        best = {
            pkgIndex,
            vendoredBase,
            suffixSegments: segments.slice(pkgIndex + 1),
        };
    }

    if (!best) return undefined;
    return best.suffixSegments.length === 0
        ? best.vendoredBase
        : join(best.vendoredBase, ...best.suffixSegments);
};

/**
 * Rewrite every Cargo.toml in a copied dependency tree. The root manifest keeps its
 * root-only tables when it's a workspace (members inherit from them); all others strip them.
 */
export const rewriteCargoTomls = async (
    srcRoot: string,
    destRoot: string,
    tree: CollectedTree,
    ctx: RewriteContext,
): Promise<void> => {
    for (const manifestDir of tree.manifestDirs) {
        const preserve = manifestDir === '.' && (await isWorkspaceRoot(destRoot));

        await rewriteCargoToml(
            join(srcRoot, manifestDir),
            join(destRoot, manifestDir, 'Cargo.toml'),
            ctx,
            !preserve,
        );
    }
};
