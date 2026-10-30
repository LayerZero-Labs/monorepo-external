import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, it, vi } from 'vitest';

import { createScopedWorkspace } from '../index';
import type { WorkspaceDependencyGraph } from '../types';
import { copyWorkspaceSources } from '../workspace-source-copy';

const vanishing = vi.hoisted(() => ({
    beforeLstat: new Set<string>(),
    afterLstat: new Set<string>(),
    atEveryLstat: new Set<string>(),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();

    return {
        ...actual,
        lstat: async (path: string) => {
            if (vanishing.atEveryLstat.has(path)) {
                const message = `ENOENT: no such file or directory, lstat '${path}'`;
                throw Object.assign(new Error(message), { code: 'ENOENT' });
            }
            if (vanishing.beforeLstat.has(path)) {
                await actual.rm(path, { force: true });
            }
            const stats = await actual.lstat(path);
            if (vanishing.afterLstat.has(path)) {
                await actual.rm(path, { force: true });
            }
            return stats;
        },
    };
});

const TMP = mkdtempSync(join(tmpdir(), 'lz-source-copy-vanished-test-'));
const SCOPED_ROOTS: string[] = [];

afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    for (const scopedRoot of SCOPED_ROOTS) {
        rmSync(scopedRoot, { recursive: true, force: true });
    }
});

const createDependency = (name: string, files: Record<string, string>) => {
    const repo = join(TMP, name);
    const dep = join(repo, 'packages', 'dep');
    for (const [file, content] of Object.entries(files)) {
        mkdirSync(join(dep, file, '..'), { recursive: true });
        writeFileSync(join(dep, file), content);
    }

    const dependencyGraph: WorkspaceDependencyGraph = {
        repoRoot: repo,
        packageRoot: join(repo, 'apps', 'current'),
        packageRelativePath: 'apps/current',
        rootNodeModulesDependencyNames: [],
        includedWorkspaceDependencies: [
            {
                name: '@layerzerolabs/dep',
                importerRelativePath: 'apps/current',
                relativePath: 'packages/dep',
                absolutePath: dep,
                version: 'link:../../packages/dep',
            },
        ],
    };

    return { dep, dependencyGraph };
};

const MAY_VANISH_PATTERNS = ['wasm/**'];

const copy = async (
    dependencyGraph: WorkspaceDependencyGraph,
    mayVanishPatterns: readonly string[] = MAY_VANISH_PATTERNS,
) => {
    const { scopedRoot, skippedSourcePaths } = await copyWorkspaceSources({
        dependencyGraph,
        mayVanishPatterns,
    });
    SCOPED_ROOTS.push(scopedRoot);
    return { copied: join(scopedRoot, 'packages', 'dep'), skippedSourcePaths };
};

describe(copyWorkspaceSources, () => {
    it('skips and reports a may-vanish source file that is removed after the listing, before its stat', async ({
        expect,
    }) => {
        const { dep, dependencyGraph } = createDependency('vanished-before-stat', {
            'src/lib.rs': 'pub fn kept() {}',
            'wasm/endpoint.wasm': 'wasm',
        });
        vanishing.beforeLstat.add(join(dep, 'wasm', 'endpoint.wasm'));

        const { copied, skippedSourcePaths } = await copy(dependencyGraph);

        expect(existsSync(join(copied, 'src', 'lib.rs'))).toBe(true);
        expect(existsSync(join(copied, 'wasm', 'endpoint.wasm'))).toBe(false);
        expect(skippedSourcePaths).toEqual(['packages/dep/wasm/endpoint.wasm']);
    });

    it('skips and reports a may-vanish source file that is removed after its stat, before its copy', async ({
        expect,
    }) => {
        const { dep, dependencyGraph } = createDependency('vanished-before-copy', {
            'src/lib.rs': 'pub fn kept() {}',
            'wasm/endpoint.wasm': 'wasm',
        });
        vanishing.afterLstat.add(join(dep, 'wasm', 'endpoint.wasm'));

        const { copied, skippedSourcePaths } = await copy(dependencyGraph);

        expect(existsSync(join(copied, 'src', 'lib.rs'))).toBe(true);
        expect(existsSync(join(copied, 'wasm', 'endpoint.wasm'))).toBe(false);
        expect(skippedSourcePaths).toEqual(['packages/dep/wasm/endpoint.wasm']);
    });

    it('skips and reports a may-vanish source symlink that is removed after its stat, before its read', async ({
        expect,
    }) => {
        const { dep, dependencyGraph } = createDependency('vanished-symlink', {
            'src/lib.rs': 'pub fn kept() {}',
            'wasm/endpoint.wasm': 'wasm',
        });
        symlinkSync('endpoint.wasm', join(dep, 'wasm', 'latest.wasm'));
        vanishing.afterLstat.add(join(dep, 'wasm', 'latest.wasm'));

        const { copied, skippedSourcePaths } = await copy(dependencyGraph);

        expect(existsSync(join(copied, 'wasm', 'endpoint.wasm'))).toBe(true);
        expect(existsSync(join(copied, 'wasm', 'latest.wasm'))).toBe(false);
        expect(skippedSourcePaths).toEqual(['packages/dep/wasm/latest.wasm']);
    });

    it.for([
        {
            timing: 'after the listing, before its stat',
            name: 'before-stat',
            removal: vanishing.beforeLstat,
        },
        {
            timing: 'after its stat, before its copy',
            name: 'before-copy',
            removal: vanishing.afterLstat,
        },
    ])(
        'fails the copy when a source file that matches no may-vanish pattern is removed $timing',
        async ({ name, removal }, { expect }) => {
            const { dep, dependencyGraph } = createDependency(`vanished-src-${name}`, {
                'src/lib.rs': 'pub fn removed() {}',
            });
            removal.add(join(dep, 'src', 'lib.rs'));

            await expect(
                copyWorkspaceSources({ dependencyGraph, mayVanishPatterns: MAY_VANISH_PATTERNS }),
            ).rejects.toMatchObject({ code: 'ENOENT' });
        },
    );

    it('fails the copy when a source file is removed and no may-vanish pattern is given', async ({
        expect,
    }) => {
        const { dep, dependencyGraph } = createDependency('vanished-no-patterns', {
            'src/lib.rs': 'pub fn kept() {}',
            '.artifacts/endpoint.wasm': 'wasm',
        });
        vanishing.beforeLstat.add(join(dep, '.artifacts', 'endpoint.wasm'));

        await expect(copyWorkspaceSources({ dependencyGraph })).rejects.toMatchObject({
            code: 'ENOENT',
        });
    });

    it('skips and reports a removed directory and its files when both match may-vanish patterns', async ({
        expect,
    }) => {
        const { dep, dependencyGraph } = createDependency('vanished-directory', {
            'src/lib.rs': 'pub fn kept() {}',
            'wasm/endpoint.wasm': 'wasm',
        });
        vanishing.atEveryLstat.add(join(dep, 'wasm'));
        vanishing.atEveryLstat.add(join(dep, 'wasm', 'endpoint.wasm'));

        const { copied, skippedSourcePaths } = await copy(dependencyGraph, ['wasm', 'wasm/**']);

        expect(existsSync(join(copied, 'src', 'lib.rs'))).toBe(true);
        expect(existsSync(join(copied, 'wasm', 'endpoint.wasm'))).toBe(false);
        expect(skippedSourcePaths).toEqual([
            'packages/dep/wasm',
            'packages/dep/wasm/endpoint.wasm',
        ]);
    });

    it('reports a removed source once when a nested included package copies it twice', async ({
        expect,
    }) => {
        const { dep, dependencyGraph } = createDependency('vanished-nested-package', {
            'src/lib.rs': 'pub fn kept() {}',
            'nested/wasm/nested.wasm': 'wasm',
        });
        const nestedSource = join(dep, 'nested', 'wasm', 'nested.wasm');
        dependencyGraph.includedWorkspaceDependencies.push({
            name: '@layerzerolabs/nested',
            importerRelativePath: 'apps/current',
            relativePath: 'packages/dep/nested',
            absolutePath: join(dep, 'nested'),
            version: 'link:../../packages/dep/nested',
        });
        vanishing.atEveryLstat.add(nestedSource);

        const { skippedSourcePaths } = await copy(dependencyGraph, ['**/wasm/**']);

        expect(skippedSourcePaths).toEqual(['packages/dep/nested/wasm/nested.wasm']);
    });

    it('reports no skipped source when every listed source is copied', async ({ expect }) => {
        const { dependencyGraph } = createDependency('nothing-vanished', {
            'src/lib.rs': 'pub fn kept() {}',
        });

        const { skippedSourcePaths } = await copy(dependencyGraph);

        expect(skippedSourcePaths).toEqual([]);
    });

    it('rethrows a copy error other than a removed source file', async ({ expect }) => {
        const { dep, dependencyGraph } = createDependency('unreadable', {
            'src/lib.rs': 'pub fn hidden() {}',
        });
        chmodSync(join(dep, 'src', 'lib.rs'), 0o000);

        await expect(copyWorkspaceSources({ dependencyGraph })).rejects.toMatchObject({
            code: 'EACCES',
        });
    });

    it.skipIf(process.getuid?.() === 0)(
        'fails the copy with EACCES when a may-vanish source file is unreadable',
        async ({ expect }) => {
            const { dep, dependencyGraph } = createDependency('unreadable-may-vanish', {
                'src/lib.rs': 'pub fn kept() {}',
                'wasm/endpoint.wasm': 'wasm',
            });
            chmodSync(join(dep, 'wasm', 'endpoint.wasm'), 0o000);

            await expect(
                copyWorkspaceSources({ dependencyGraph, mayVanishPatterns: MAY_VANISH_PATTERNS }),
            ).rejects.toMatchObject({ code: 'EACCES' });
        },
    );
});

describe(createScopedWorkspace, () => {
    it('skips the sources that match the pruner may-vanish patterns and adds one diagnostic with their count and paths', async ({
        expect,
    }) => {
        const { dep } = createDependency('vanished-diagnostic', {
            'package.json': JSON.stringify({ name: '@layerzerolabs/dep', version: '0.0.0' }),
            'src/lib.rs': 'pub fn kept() {}',
            'wasm/endpoint.wasm': 'wasm',
            'wasm/oapp.wasm': 'wasm',
        });
        const repo = join(dep, '..', '..');
        const current = join(repo, 'apps', 'current');
        mkdirSync(current, { recursive: true });
        writeFileSync(
            join(current, 'package.json'),
            JSON.stringify({ name: '@layerzerolabs/current', version: '0.0.0' }),
        );
        writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "**"\n');
        writeFileSync(
            join(repo, 'pnpm-lock.yaml'),
            [
                "lockfileVersion: '9.0'",
                '',
                'importers:',
                '  apps/current:',
                '    dependencies:',
                "      '@layerzerolabs/dep':",
                '        specifier: workspace:*',
                '        version: link:../../packages/dep',
                '',
                '  packages/dep: {}',
                '',
                'packages: {}',
                '',
            ].join('\n'),
        );
        vanishing.beforeLstat.add(join(realpathSync(dep), 'wasm', 'oapp.wasm'));
        vanishing.afterLstat.add(join(realpathSync(dep), 'wasm', 'endpoint.wasm'));

        const result = await createScopedWorkspace({
            cwd: current,
            pruner: {
                name: 'may-vanish',
                createPrunePlan: async () => ({
                    patterns: [],
                    mayVanishPatterns: MAY_VANISH_PATTERNS,
                    diagnostics: ['may-vanish pruner'],
                }),
            },
        });
        SCOPED_ROOTS.push(result.scopedRoot);

        expect(result.diagnostics).toEqual([
            'may-vanish pruner',
            'Scoped copy skipped sources removed during the copy (2): packages/dep/wasm/endpoint.wasm, packages/dep/wasm/oapp.wasm',
        ]);
    });
});
