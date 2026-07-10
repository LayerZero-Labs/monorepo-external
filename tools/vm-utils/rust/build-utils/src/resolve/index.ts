/**
 * Vendor @layerzerolabs Cargo dependencies from node_modules into a flat
 * dependencies/ directory with rewritten path deps, so a Rust package builds
 * without the rest of the monorepo.
 */

import { copyFile, mkdir, rm } from 'fs/promises';
import { join, relative, resolve } from 'path';

import { logger } from '../logger';
import { discoverPackages, isCrate, type VendorTarget } from './discover';
import type { CollectedTree } from './io';
import { collectFiles } from './io';
import type { RewriteContext } from './rewrite';
import { rewriteCargoTomls } from './rewrite';

// ─── Path Map ───

/** Maps each crate's npm package source path to its vendored dependencies/ location. */
export const buildDependenciesPathMap = (targets: VendorTarget[]): Map<string, string> => {
    const pathMap = new Map<string, string>();

    for (const { npmPkgDir, depsPkgDir, tree } of targets) {
        for (const dir of tree.manifestDirs) {
            pathMap.set(join(npmPkgDir, dir), join(depsPkgDir, dir));
            logger.trace(`map ${join(npmPkgDir, dir)} -> ${join(depsPkgDir, dir)}`);
        }
    }
    logger.debug(`built dependency path map: ${pathMap.size} entries`);
    return pathMap;
};

// ─── File Operations ───

/** Copy a collected tree into destRoot. */
const copyCollected = async (
    srcRoot: string,
    destRoot: string,
    tree: CollectedTree,
): Promise<void> => {
    await mkdir(destRoot, { recursive: true });
    await Promise.all(tree.dirs.map((dir) => mkdir(join(destRoot, dir), { recursive: true })));
    await Promise.all(
        tree.files.map((file) => copyFile(join(srcRoot, file), join(destRoot, file))),
    );
};

/** Resolves the Cargo root: `cargoDir` if provided, else `packageRoot`. Throws if no Cargo.toml. */
const resolveCargoRoot = async (packageRoot: string, cargoDir?: string): Promise<string> => {
    if (cargoDir) {
        const resolved = resolve(packageRoot, cargoDir);
        if (!(await isCrate(resolved))) {
            throw new Error(`--cargo-dir ${cargoDir} does not contain a Cargo.toml`);
        }
        return resolved;
    }

    if (!(await isCrate(packageRoot))) {
        throw new Error(`${packageRoot} does not contain a Cargo.toml`);
    }

    return packageRoot;
};

// ─── Public API ───

/**
 * Entry point: vendor every @layerzerolabs Cargo crate reachable through node_modules
 * into dependencies/, with path deps rewritten to resolve locally.
 *
 * @param cwd       pnpm package root (where node_modules/ lives). Default: process.cwd()
 * @param cargoDir  Cargo crate directory to vendor into. Default: packageRoot
 */
export const resolveDependencies = async ({
    cwd,
    cargoDir,
}: { cwd?: string; cargoDir?: string } = {}): Promise<void> => {
    const packageRoot = resolve(cwd ?? process.cwd());

    const depsRoot = join(await resolveCargoRoot(packageRoot, cargoDir), 'dependencies');

    const discovered = new Map<string, string>();
    await discoverPackages(packageRoot, discovered, new Set());

    if (discovered.size === 0) {
        logger.info('No @layerzerolabs namespaced Cargo dependencies found in node_modules');
        return;
    }

    // Rebuild dependencies/ from scratch each run.
    await rm(depsRoot, { recursive: true, force: true });
    await mkdir(depsRoot, { recursive: true });

    // Collect each package's tree once — copy, path map, and rewrite all reuse it.
    const targets: VendorTarget[] = await Promise.all(
        Array.from(discovered, async ([pkgName, npmPkgDir]) => {
            const tree = await collectFiles(npmPkgDir);
            logger.debug(
                `${pkgName}: collected ${tree.files.length} files, ${tree.dirs.length} dirs`,
            );
            return { pkgName, npmPkgDir, depsPkgDir: join(depsRoot, pkgName), tree };
        }),
    );

    const ctx: RewriteContext = {
        pathMap: buildDependenciesPathMap(targets),
        discovered,
    };
    logger.debug(`path map: ${ctx.pathMap.size} entries`);

    await Promise.all(
        targets.map(async ({ pkgName, npmPkgDir, depsPkgDir, tree }) => {
            await copyCollected(npmPkgDir, depsPkgDir, tree);
            await rewriteCargoTomls(npmPkgDir, depsPkgDir, tree, ctx);
            logger.debug(`  ${pkgName} -> ${npmPkgDir}`);
        }),
    );

    logger.info(
        `Resolved ${discovered.size} Cargo dependencies into ${relative(packageRoot, depsRoot) || './dependencies/'}`,
    );
};
