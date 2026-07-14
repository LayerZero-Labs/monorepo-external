import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'smol-toml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { collectFiles } from '../../src/resolve/io';
import type { RewriteContext } from '../../src/resolve/rewrite';
import { rewriteCargoToml, rewriteCargoTomls } from '../../src/resolve/rewrite';
import { fixture } from './fixtures';

const TMP = join(__dirname, '__tmp_rewrite__');

const writeToml = (path: string, content: string) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
};

const readToml = (path: string) => readFileSync(path, 'utf-8');

/** Read + parse a written manifest — assertions check structure, not formatting. */
const readParsed = (path: string): Record<string, unknown> => parse(readFileSync(path, 'utf-8'));

/** The `path` value of a dependency in a given table, or undefined. */
const depPath = (manifest: Record<string, unknown>, table: string, dep: string): unknown => {
    const deps = manifest[table] as Record<string, { path?: unknown }> | undefined;
    return deps?.[dep]?.path;
};

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

describe('rewriteCargoToml', () => {
    it('rewrites path deps using name fallback when realpath fails', async () => {
        const depsDir = join(TMP, 'dependencies');
        const crateDir = join(TMP, 'programs', 'my-program');
        const cargoToml = join(crateDir, 'Cargo.toml');

        writeToml(cargoToml, fixture('mixed-deps.toml'));

        const ctx: RewriteContext = {
            pathMap: new Map([['/real/rbac', join(depsDir, 'utils-solana-rbac')]]),
            discovered: new Map([['utils-solana-rbac', '/real/rbac']]),
        };

        await rewriteCargoToml(crateDir, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).toContain('rbac = { path = "../../dependencies/utils-solana-rbac" }');
        expect(result).toContain('anchor-lang = { version = "0.32.1" }');
        expect(result).toContain('num_enum = { version = "0.7" }');
    });

    it('rewrites macros subdir paths via parent name match', async () => {
        const depsDir = join(TMP, 'dependencies');
        const crateDir = join(TMP, 'programs', 'my-program');
        const cargoToml = join(crateDir, 'Cargo.toml');

        writeToml(cargoToml, fixture('program-with-macros.toml'));

        const ctx: RewriteContext = {
            pathMap: new Map([
                ['/real/rbac', join(depsDir, 'utils-solana-rbac')],
                ['/real/rbac/macros', join(depsDir, 'utils-solana-rbac', 'macros')],
            ]),
            discovered: new Map([['utils-solana-rbac', '/real/rbac']]),
        };

        await rewriteCargoToml(crateDir, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).toContain(
            'rbac-macros = { path = "../../dependencies/utils-solana-rbac/macros" }',
        );
    });

    it('rewrites arbitrary-depth paths below a discovered package stem', async () => {
        const depsDir = join(TMP, 'dependencies');
        const crateDir = join(TMP, 'programs', 'oft-core');
        const cargoToml = join(crateDir, 'Cargo.toml');

        writeToml(cargoToml, fixture('oft-core-with-stale-deep-deps.toml'));

        const protocolRoot = join(depsDir, 'protocol-stellar-v2');
        const ctx: RewriteContext = {
            pathMap: new Map([
                ['/real/protocol', protocolRoot],
                ['/real/protocol/endpoint-v2', join(protocolRoot, 'endpoint-v2')],
                [
                    '/real/protocol/message-libs/simple-message-lib',
                    join(protocolRoot, 'message-libs', 'simple-message-lib'),
                ],
                [
                    '/real/protocol/message-libs/message-lib-common',
                    join(protocolRoot, 'message-libs', 'message-lib-common'),
                ],
            ]),
            discovered: new Map([['protocol-stellar-v2', '/real/protocol']]),
        };

        await rewriteCargoToml(crateDir, cargoToml, ctx);
        const manifest = readParsed(cargoToml);

        expect(depPath(manifest, 'dependencies', 'endpoint-v2')).toBe(
            join('..', '..', 'dependencies', 'protocol-stellar-v2', 'endpoint-v2'),
        );
        expect(depPath(manifest, 'dev-dependencies', 'simple-message-lib')).toBe(
            join(
                '..',
                '..',
                'dependencies',
                'protocol-stellar-v2',
                'message-libs',
                'simple-message-lib',
            ),
        );
        expect(depPath(manifest, 'dev-dependencies', 'message-lib-common')).toBe(
            join(
                '..',
                '..',
                'dependencies',
                'protocol-stellar-v2',
                'message-libs',
                'message-lib-common',
            ),
        );
    });

    it('prefers the deepest discovered package stem over Map insertion order', async () => {
        // Path contains both a shallow parent package name and a nested child package
        // name. Insertion order lists the parent first — first-match would wrongly
        // rewrite under the parent; most-specific must use the child stem.
        const depsDir = join(TMP, 'dependencies');
        const crateDir = join(TMP, 'programs', 'consumer');
        const cargoToml = join(crateDir, 'Cargo.toml');

        writeToml(
            cargoToml,
            '[dependencies]\nmacros = { path = "../../node_modules/parent-pkg/child-pkg/macros" }\n',
        );

        const ctx: RewriteContext = {
            pathMap: new Map([
                ['/real/parent', join(depsDir, 'parent-pkg')],
                ['/real/child', join(depsDir, 'child-pkg')],
            ]),
            // Parent inserted first — old first-match behavior would select it.
            discovered: new Map([
                ['parent-pkg', '/real/parent'],
                ['child-pkg', '/real/child'],
            ]),
        };

        await rewriteCargoToml(crateDir, cargoToml, ctx);

        expect(depPath(readParsed(cargoToml), 'dependencies', 'macros')).toBe(
            join('..', '..', 'dependencies', 'child-pkg', 'macros'),
        );
    });

    it('preserves features and other inline attrs', async () => {
        const depsDir = join(TMP, 'dependencies');
        const cargoToml = join(TMP, 'Cargo.toml');

        writeToml(cargoToml, fixture('with-features.toml'));

        const ctx: RewriteContext = {
            pathMap: new Map([['/real/rbac', join(depsDir, 'utils-solana-rbac')]]),
            discovered: new Map([['utils-solana-rbac', '/real/rbac']]),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).toContain('features = ["idl-build"]');
        expect(result).toContain('path = "dependencies/utils-solana-rbac"');
    });

    it('does not modify file when no path deps match and no workspace', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        const original = fixture('no-path-deps.toml');

        writeToml(cargoToml, original);

        const ctx: RewriteContext = {
            pathMap: new Map(),
            discovered: new Map(),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);
        expect(readToml(cargoToml)).toBe(original);
    });

    it('strips [workspace] table at top of file', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('workspace-at-top.toml'));

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        await rewriteCargoToml(TMP, cargoToml, ctx);
        const manifest = readParsed(cargoToml);

        expect(manifest.workspace).toBeUndefined();
        expect(manifest.package).toMatchObject({ name: 'my-lib' });
        expect(manifest.dependencies).toHaveProperty('anchor-lang');
    });

    it('strips [workspace] sandwiched between other sections', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('workspace-middle.toml'));

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        await rewriteCargoToml(TMP, cargoToml, ctx);
        const manifest = readParsed(cargoToml);

        expect(manifest.workspace).toBeUndefined();
        expect(manifest.package).toMatchObject({ name: 'my-lib' });
        expect(manifest.dependencies).toHaveProperty('anchor-lang');
    });

    it('strips [workspace] at end of file with no trailing section', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('workspace-at-end.toml'));

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        await rewriteCargoToml(TMP, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).not.toContain('[workspace]');
        expect(result).not.toContain('members');
        expect(result).not.toContain('resolver');
        expect(result).toContain('[package]');
        expect(result).toContain('name = "my-lib"');
    });

    it('strips [workspace] and rewrites path deps in the same pass', async () => {
        const depsDir = join(TMP, 'dependencies');
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('workspace-with-path-deps.toml'));

        const ctx: RewriteContext = {
            pathMap: new Map([['/real/rbac', join(depsDir, 'utils-solana-rbac')]]),
            discovered: new Map([['utils-solana-rbac', '/real/rbac']]),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).not.toContain('[workspace]');
        expect(result).toContain('path = "dependencies/utils-solana-rbac"');
        expect(result).toContain('name = "oapp"');
    });

    it('strips root-only [patch.*] and [profile.*] tables from vendored manifests', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('root-only-sections.toml'));

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        await rewriteCargoToml(TMP, cargoToml, ctx);
        const manifest = readParsed(cargoToml);

        expect(manifest.package).toBeDefined();
        expect(manifest.dependencies).toBeDefined();
        expect(manifest.patch).toBeUndefined();
        expect(manifest.profile).toBeUndefined();
    });
});

describe('rewriteCargoToml — path dep syntax variants', () => {
    it('rewrites table-syntax path deps ([dependencies.dep]\\npath = "...")', async () => {
        // Structural TOML parsing handles the table-header form too — the old
        // inline-table-only regex did not, so this is a fixed limitation.
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(
            cargoToml,
            '[package]\nname = "x"\n\n[dependencies.rbac]\npath = "dependencies/utils-solana-rbac"\n',
        );

        const ctx: RewriteContext = {
            pathMap: new Map([['/real/rbac', join(TMP, 'deps', 'utils-solana-rbac')]]),
            discovered: new Map([['utils-solana-rbac', '/real/rbac']]),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);
        expect(depPath(readParsed(cargoToml), 'dependencies', 'rbac')).toBe(
            join('deps', 'utils-solana-rbac'),
        );
    });

    it('rewrites path deps in [dev-dependencies] and [build-dependencies]', async () => {
        const depsDir = join(TMP, 'dependencies');
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('multi-section-path-deps.toml'));

        const ctx: RewriteContext = {
            pathMap: new Map([
                ['/real/test-utils', join(depsDir, 'test-utils')],
                ['/real/codegen-utils', join(depsDir, 'codegen-utils')],
            ]),
            discovered: new Map([
                ['test-utils', '/real/test-utils'],
                ['codegen-utils', '/real/codegen-utils'],
            ]),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).toContain('test-utils = { path = "dependencies/test-utils" }');
        expect(result).toContain('codegen = { path = "dependencies/codegen-utils" }');
    });

    it("rewrites path deps in [target.'cfg(...)'.dependencies]", async () => {
        const depsDir = join(TMP, 'dependencies');
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('target-cfg-path-dep.toml'));

        const ctx: RewriteContext = {
            pathMap: new Map([['/real/wasm-utils', join(depsDir, 'wasm-utils')]]),
            discovered: new Map([['wasm-utils', '/real/wasm-utils']]),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).toContain('wasm-utils = { path = "dependencies/wasm-utils" }');
    });

    it('rewrites multiple path deps in one [dependencies] block in a single pass', async () => {
        const depsDir = join(TMP, 'dependencies');
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('multi-path-deps.toml'));

        const ctx: RewriteContext = {
            pathMap: new Map([
                ['/real/pkg-a', join(depsDir, 'pkg-a')],
                ['/real/pkg-b', join(depsDir, 'pkg-b')],
                ['/real/pkg-c', join(depsDir, 'pkg-c')],
            ]),
            discovered: new Map([
                ['pkg-a', '/real/pkg-a'],
                ['pkg-b', '/real/pkg-b'],
                ['pkg-c', '/real/pkg-c'],
            ]),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).toContain('pkg-a = { path = "dependencies/pkg-a" }');
        expect(result).toContain('pkg-b = { path = "dependencies/pkg-b" }');
        expect(result).toContain('pkg-c = { path = "dependencies/pkg-c" }');
    });
});

describe('rewriteCargoToml — primary pathMap resolution (no fallback)', () => {
    it('rewrites via pathMap lookup when path resolves directly (no symlink needed)', async () => {
        // Create a real directory so realpath(join(TMP, 'src-crate')) succeeds.
        const srcCrateDir = join(TMP, 'src-crate');
        const depsDir = join(TMP, 'dependencies');
        mkdirSync(srcCrateDir, { recursive: true });

        // The consumer Cargo.toml lives at TMP root; its path dep points at src-crate/.
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, '[dependencies]\nmy-pkg = { path = "src-crate" }');

        // pathMap uses the real (non-symlinked) path as the key — primary resolution
        const ctx: RewriteContext = {
            pathMap: new Map([[srcCrateDir, join(depsDir, 'my-pkg')]]),
            discovered: new Map([['my-pkg', srcCrateDir]]),
        };

        await rewriteCargoToml(TMP, cargoToml, ctx);

        expect(depPath(readParsed(cargoToml), 'dependencies', 'my-pkg')).toBe(
            join('dependencies', 'my-pkg'),
        );
    });
});

describe('rewriteCargoToml — root table stripping edge cases', () => {
    it('strips [patch."https://..."] and [profile.dev.package.*] sub-tables', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('patch-multi-registry.toml'));

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        await rewriteCargoToml(TMP, cargoToml, ctx);
        const manifest = readParsed(cargoToml);

        expect(manifest.package).toBeDefined();
        expect(manifest.dependencies).toBeDefined();
        expect(manifest.patch).toBeUndefined();
        expect(manifest.profile).toBeUndefined();
    });

    it('strips [workspace] with no trailing newline at EOF', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        // No trailing newline after [workspace] block
        writeToml(cargoToml, '[package]\nname = "x"\n\n[workspace]\nmembers = ["a"]');

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        await rewriteCargoToml(TMP, cargoToml, ctx);
        const result = readToml(cargoToml);

        expect(result).not.toContain('[workspace]');
        expect(result).toContain('[package]');
        expect(result).toContain('name = "x"');
    });
});

describe('rewriteCargoToml — pruneExcludedLiteralMembers edge cases', () => {
    it('prunes excluded literal from default-members and members in same manifest', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        writeToml(cargoToml, fixture('workspace-with-default-members.toml'));

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        // stripRootTables=false → preserve workspace, prune excluded members
        await rewriteCargoToml(TMP, cargoToml, ctx, false);
        const result = readToml(cargoToml);

        expect(result).not.toContain('tests/mock');
        expect(result).toContain('contracts/*');
        expect(result).toContain('contracts/main');
        expect(result).toContain('[workspace]');
    });

    it('does NOT prune a glob member pattern even when it starts with an excluded segment', async () => {
        const cargoToml = join(TMP, 'Cargo.toml');
        // "tests/*" is a glob — not a resolved literal pointing into tests/, so it is kept.
        // Cargo will expand it at build time over the (already test-free) vendored tree,
        // resulting in an empty expansion — not an error.
        writeToml(cargoToml, '[workspace]\nmembers = ["contracts/*", "tests/*"]\n');

        const ctx: RewriteContext = { pathMap: new Map(), discovered: new Map() };
        await rewriteCargoToml(TMP, cargoToml, ctx, false);
        const result = readToml(cargoToml);

        expect(result).toContain('contracts/*');
        expect(result).toContain('tests/*');
    });
});

describe('rewriteCargoToml — preserved workspace root [workspace.dependencies] paths', () => {
    it('keeps [workspace.dependencies] paths intact — they are relative within the vendored workspace', async () => {
        // [workspace.dependencies] entries like `utils = { path = "contracts/utils" }` are
        // relative to the workspace root. Since the entire workspace is vendored intact at
        // dependencies/<pkg>/, those relative paths remain correct inside the copy.
        // The realpath of `join(originalDir, "contracts/utils")` won't resolve to a pathMap
        // key (it's an internal sub-path, not a separate npm package), so the path is left unchanged.
        const cargoToml = join(TMP, 'Cargo.toml');
        const original = [
            '[workspace]',
            'resolver = "2"',
            'members = ["contracts/utils"]',
            '',
            '[workspace.dependencies]',
            'utils = { path = "contracts/utils" }',
        ].join('\n');

        writeToml(cargoToml, original);

        const ctx: RewriteContext = {
            pathMap: new Map([['/real/protocol', join(TMP, 'dependencies', 'protocol')]]),
            discovered: new Map([['protocol', '/real/protocol']]),
        };

        await rewriteCargoToml('/real/protocol', cargoToml, ctx, false);
        const result = readToml(cargoToml);

        expect(result).toContain('[workspace]');
        expect(result).toContain('[workspace.dependencies]');
        // Path unchanged — still relative within the vendored workspace tree
        expect(result).toContain('utils = { path = "contracts/utils" }');
    });
});

describe('rewriteCargoTomls', () => {
    it('rewrites root Cargo.toml and nested subdir Cargo.toml', async () => {
        const depsDir = join(TMP, 'deps');
        const crateDir = join(TMP, 'my-crate');
        const macrosDir = join(crateDir, 'macros');

        writeToml(
            join(crateDir, 'Cargo.toml'),
            '[dependencies]\ndep-a = { path = "dependencies/dep-a" }',
        );
        writeToml(
            join(macrosDir, 'Cargo.toml'),
            '[dependencies]\ndep-a = { path = "../dependencies/dep-a" }',
        );

        const ctx: RewriteContext = {
            pathMap: new Map([['/real/dep-a', join(depsDir, 'dep-a')]]),
            discovered: new Map([['dep-a', '/real/dep-a']]),
        };

        const tree = await collectFiles(crateDir);
        await rewriteCargoTomls(crateDir, crateDir, tree, ctx);

        const rootResult = readToml(join(crateDir, 'Cargo.toml'));
        const macrosResult = readToml(join(macrosDir, 'Cargo.toml'));

        expect(rootResult).toContain(`path = "${join('..', 'deps', 'dep-a')}"`);
        expect(macrosResult).toContain(`path = "${join('..', '..', 'deps', 'dep-a')}"`);
    });
});
