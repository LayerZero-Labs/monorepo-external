import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildDependenciesPathMap } from '../../src/resolve';
import {
    discoverPackages,
    isCrate,
    isWorkspaceRoot,
    type VendorTarget,
} from '../../src/resolve/discover';
import { collectFiles } from '../../src/resolve/io';

const TMP = join(__dirname, '__tmp_discover__');

const createFile = (path: string, content = '') => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
};

const createCrate = (path: string, cargoContent = '[package]\nname = "test"') => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'Cargo.toml'), cargoContent);
};

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('isCrate', () => {
    it('returns true for directory with Cargo.toml', async () => {
        createCrate(join(TMP, 'my-crate'));
        expect(await isCrate(join(TMP, 'my-crate'))).toBe(true);
    });

    it('returns false for directory without Cargo.toml', async () => {
        mkdirSync(join(TMP, 'not-a-crate'), { recursive: true });
        expect(await isCrate(join(TMP, 'not-a-crate'))).toBe(false);
    });

    it('returns false for nonexistent path', async () => {
        expect(await isCrate(join(TMP, 'nope'))).toBe(false);
    });

    it('returns false for a file', async () => {
        createFile(join(TMP, 'a-file'), 'hello');
        expect(await isCrate(join(TMP, 'a-file'))).toBe(false);
    });
});

describe('discoverPackages', () => {
    it('discovers @layerzerolabs packages with Cargo.toml from node_modules', async () => {
        // Simulate: TMP/node_modules/@layerzerolabs/my-crate/Cargo.toml
        const cratePath = join(TMP, 'node_modules', '@layerzerolabs', 'my-crate');
        createCrate(cratePath);

        const discovered = new Map<string, string>();
        await discoverPackages(TMP, discovered, new Set());

        expect(discovered.size).toBe(1);
        expect(discovered.has('my-crate')).toBe(true);
    });

    it('skips packages without Cargo.toml', async () => {
        const pkgPath = join(TMP, 'node_modules', '@layerzerolabs', 'ts-only-pkg');
        mkdirSync(pkgPath, { recursive: true });
        writeFileSync(join(pkgPath, 'package.json'), '{}');

        const discovered = new Map<string, string>();
        await discoverPackages(TMP, discovered, new Set());

        expect(discovered.size).toBe(0);
    });

    it('discovers transitive deps by recursing into package node_modules', async () => {
        // Root depends on pkg-a, pkg-a depends on pkg-b
        const pkgA = join(TMP, 'node_modules', '@layerzerolabs', 'pkg-a');
        const pkgB = join(pkgA, 'node_modules', '@layerzerolabs', 'pkg-b');
        createCrate(pkgA);
        createCrate(pkgB);

        const discovered = new Map<string, string>();
        await discoverPackages(TMP, discovered, new Set());

        expect(discovered.size).toBe(2);
        expect(discovered.has('pkg-a')).toBe(true);
        expect(discovered.has('pkg-b')).toBe(true);
    });

    it('deduplicates packages seen through multiple paths', async () => {
        // Both pkg-a and pkg-b depend on shared (via symlinks in real pnpm,
        // but here we just put it in both node_modules)
        const pkgA = join(TMP, 'node_modules', '@layerzerolabs', 'pkg-a');
        const shared = join(TMP, 'node_modules', '@layerzerolabs', 'shared');
        const sharedViaA = join(pkgA, 'node_modules', '@layerzerolabs', 'shared');
        createCrate(pkgA);
        createCrate(shared);
        createCrate(sharedViaA);

        const discovered = new Map<string, string>();
        await discoverPackages(TMP, discovered, new Set());

        // "shared" discovered once from root, not duplicated from pkg-a's copy
        expect(discovered.size).toBe(2); // pkg-a + shared
    });
});

describe('isWorkspaceRoot', () => {
    it('returns true when Cargo.toml has a [workspace] table', async () => {
        createCrate(join(TMP, 'ws'), '[workspace]\nmembers = ["contracts/*"]');
        expect(await isWorkspaceRoot(join(TMP, 'ws'))).toBe(true);
    });

    it('returns true for a virtual manifest ([workspace] without [package])', async () => {
        createCrate(join(TMP, 'virtual'), '[workspace]\nresolver = "2"\nmembers = ["a"]');
        expect(await isWorkspaceRoot(join(TMP, 'virtual'))).toBe(true);
    });

    it('returns false for a bare [package] (standalone single crate)', async () => {
        createCrate(join(TMP, 'leaf'), '[package]\nname = "leaf"');
        expect(await isWorkspaceRoot(join(TMP, 'leaf'))).toBe(false);
    });

    it('returns false when there is no Cargo.toml', async () => {
        mkdirSync(join(TMP, 'empty'), { recursive: true });
        expect(await isWorkspaceRoot(join(TMP, 'empty'))).toBe(false);
    });
});

describe('buildDependenciesPathMap', () => {
    // Build a VendorTarget by collecting the crate's tree (same input the pipeline feeds it).
    const toTarget = async (
        pkgName: string,
        npmPkgDir: string,
        depsDir: string,
    ): Promise<VendorTarget> => ({
        pkgName,
        npmPkgDir,
        depsPkgDir: join(depsDir, pkgName),
        tree: await collectFiles(npmPkgDir),
    });

    it('maps discovered packages to dependencies/ targets', async () => {
        const depsDir = join(TMP, 'dependencies');
        // A discovered package always has a root Cargo.toml (isCrate-verified), so its
        // '.' manifest dir maps the package root to its dependencies/ target.
        const rbac = join(TMP, 'rbac');
        const oapp = join(TMP, 'oapp');
        createCrate(rbac);
        createCrate(oapp);
        const targets = [
            await toTarget('utils-solana-rbac', rbac, depsDir),
            await toTarget('oapp-solana-impl', oapp, depsDir),
        ];

        const pathMap = buildDependenciesPathMap(targets);

        expect(pathMap.get(rbac)).toBe(join(depsDir, 'utils-solana-rbac'));
        expect(pathMap.get(oapp)).toBe(join(depsDir, 'oapp-solana-impl'));
    });

    it('includes subdirectories with Cargo.toml (macros/)', async () => {
        const depsDir = join(TMP, 'dependencies');
        const crateDir = join(TMP, 'real-crate');
        createCrate(crateDir);
        createCrate(join(crateDir, 'macros'));

        const pathMap = buildDependenciesPathMap([await toTarget('my-crate', crateDir, depsDir)]);

        expect(pathMap.get(crateDir)).toBe(join(depsDir, 'my-crate'));
        expect(pathMap.get(join(crateDir, 'macros'))).toBe(join(depsDir, 'my-crate', 'macros'));
    });

    it('skips excluded directories like node_modules and target', async () => {
        const depsDir = join(TMP, 'dependencies');
        const crateDir = join(TMP, 'real-crate');
        createCrate(crateDir);
        createCrate(join(crateDir, 'node_modules')); // should be excluded
        createCrate(join(crateDir, 'target')); // should be excluded

        const pathMap = buildDependenciesPathMap([await toTarget('my-crate', crateDir, depsDir)]);

        expect(pathMap.size).toBe(1); // only the root, no subdirs
    });

    it('maps every crate dir (incl. deeply nested) to its dependencies/ target', async () => {
        const depsDir = join(TMP, 'dependencies');
        const crateDir = join(TMP, 'protocol-stellar');
        createCrate(crateDir, '[workspace]\nmembers = ["contracts/*", "contracts/oapps/*"]');
        createCrate(join(crateDir, 'contracts', 'utils'));
        createCrate(join(crateDir, 'contracts', 'oapps'));
        createCrate(join(crateDir, 'contracts', 'oapps', 'oft-core'));

        const pathMap = buildDependenciesPathMap([
            await toTarget('protocol-stellar', crateDir, depsDir),
        ]);

        expect(pathMap.get(crateDir)).toBe(join(depsDir, 'protocol-stellar'));
        expect(pathMap.get(join(crateDir, 'contracts', 'utils'))).toBe(
            join(depsDir, 'protocol-stellar', 'contracts', 'utils'),
        );
        // the deep member — the case the old one-level scan missed
        expect(pathMap.get(join(crateDir, 'contracts', 'oapps', 'oft-core'))).toBe(
            join(depsDir, 'protocol-stellar', 'contracts', 'oapps', 'oft-core'),
        );
    });
});
