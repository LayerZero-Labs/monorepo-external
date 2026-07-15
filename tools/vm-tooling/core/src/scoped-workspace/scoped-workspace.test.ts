import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readlinkSync,
    realpathSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
    createScopedWorkspace,
    DEFAULT_SOURCE_COPY_PATTERNS,
    type ScopedWorkspacePruner,
} from './index';
import { copyRootNodeModulesSymlinks, getPnpmVirtualStoreMount } from './node-modules';
import { resolveWorkspaceDependencyGraph } from './workspace-dependency-graph';
import { copyWorkspaceSources } from './workspace-source-copy';

const TMP = mkdtempSync(join(tmpdir(), 'lz-scoped-workspace-test-'));
const GENERATED_SCOPED_ROOTS: string[] = [];

const trackScopedRoot = (scopedRoot: string): string => {
    GENERATED_SCOPED_ROOTS.push(scopedRoot);
    return scopedRoot;
};

const createPackage = (dir: string, name: string, files: Record<string, string> = {}) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '0.0.0' }));

    for (const [file, content] of Object.entries(files)) {
        const filePath = join(dir, file);
        mkdirSync(join(filePath, '..'), { recursive: true });
        writeFileSync(filePath, content);
    }
};

const createRepo = (name: string): string => {
    const repo = join(TMP, name);
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, 'pnpm-workspace.yaml'), 'packages:\n  - "**"\n');
    return repo;
};

const writeLockfile = (repo: string, body: string) => {
    writeFileSync(
        join(repo, 'pnpm-lock.yaml'),
        [
            "lockfileVersion: '9.0'",
            '',
            'settings:',
            '  autoInstallPeers: true',
            '',
            'importers:',
            body.trimEnd(),
            '',
            'packages:',
            '',
        ].join('\n'),
    );
};

afterAll(() => {
    rmSync(TMP, { recursive: true, force: true });
    for (const scopedRoot of GENERATED_SCOPED_ROOTS) {
        rmSync(scopedRoot, { recursive: true, force: true });
    }
});

describe(resolveWorkspaceDependencyGraph, () => {
    it('follows transitive workspace link deps', async () => {
        const repo = createRepo('dependency-graph');
        const current = join(repo, 'apps', 'current');
        const depA = join(repo, 'packages', 'dep-a');
        const depB = join(repo, 'packages', 'dep-b');
        const tooling = join(repo, 'tools', 'vm-utils', 'solana', 'build-utils');

        createPackage(current, '@layerzerolabs/current');
        createPackage(depA, '@layerzerolabs/dep-a');
        createPackage(depB, '@layerzerolabs/dep-b');
        createPackage(tooling, '@layerzerolabs/build-utils-solana');
        writeLockfile(
            repo,
            `
  apps/current:
    dependencies:
      '@layerzerolabs/dep-a':
        specifier: workspace:*
        version: link:../../packages/dep-a
      '@layerzerolabs/build-utils-solana':
        specifier: workspace:*
        version: link:../../tools/vm-utils/solana/build-utils

  .:
    devDependencies:
      eslint:
        specifier: ^9.0.0
        version: 9.0.0
      '@layerzerolabs/dep-a':
        specifier: workspace:*
        version: link:packages/dep-a
      '@layerzerolabs/build-utils-solana':
        specifier: workspace:*
        version: link:tools/vm-utils/solana/build-utils

  packages/dep-a:
    dependencies:
      eslint:
        specifier: ^9.0.0
        version: 9.0.0
      '@layerzerolabs/dep-b':
        specifier: workspace:*
        version: link:../dep-b

  packages/dep-b:
    dependencies:
      '@layerzerolabs/dep-a':
        specifier: workspace:*
        version: link:../dep-a

  tools/vm-utils/solana/build-utils:
    devDependencies: {}
`,
        );

        const dependencyGraph = await resolveWorkspaceDependencyGraph({
            cwd: current,
            repoRoot: repo,
        });

        const includedRelativePaths = dependencyGraph.includedWorkspaceDependencies.map(
            (dependency) => dependency.relativePath,
        );
        expect(includedRelativePaths).toHaveLength(3);
        expect(includedRelativePaths).toEqual(
            expect.arrayContaining([
                'packages/dep-a',
                'packages/dep-b',
                'tools/vm-utils/solana/build-utils',
            ]),
        );
        expect(dependencyGraph.rootNodeModulesDependencyNames).toHaveLength(3);
        expect(dependencyGraph.rootNodeModulesDependencyNames).toEqual(
            expect.arrayContaining([
                '@layerzerolabs/build-utils-solana',
                '@layerzerolabs/dep-a',
                'eslint',
            ]),
        );
    });

    it('resolves nested command directories to their ancestor package importer', async () => {
        const repo = createRepo('nested-current');
        const current = join(repo, 'packages', 'onesig', 'onesig-starknet');
        const contracts = join(current, 'contracts');
        const dep = join(repo, 'packages', 'protocol-starknet-v2');

        createPackage(current, '@layerzerolabs/onesig-starknet', {
            'contracts/Scarb.toml': '[package]\nname = "onesig"\n',
        });
        createPackage(dep, '@layerzerolabs/protocol-starknet-v2');
        mkdirSync(contracts, { recursive: true });
        writeLockfile(
            repo,
            `
  packages/onesig/onesig-starknet:
    devDependencies:
      '@layerzerolabs/protocol-starknet-v2':
        specifier: workspace:*
        version: link:../../protocol-starknet-v2

  .:
    devDependencies:
      '@layerzerolabs/protocol-starknet-v2':
        specifier: workspace:*
        version: link:packages/protocol-starknet-v2

  packages/protocol-starknet-v2:
    devDependencies: {}
`,
        );

        const dependencyGraph = await resolveWorkspaceDependencyGraph({
            cwd: contracts,
            repoRoot: repo,
        });

        expect(dependencyGraph.packageRoot).toBe(realpathSync(current));
        expect(dependencyGraph.packageRelativePath).toBe('packages/onesig/onesig-starknet');
        expect(
            dependencyGraph.includedWorkspaceDependencies.map(
                (dependency) => dependency.relativePath,
            ),
        ).toEqual(['packages/protocol-starknet-v2']);
        expect(dependencyGraph.rootNodeModulesDependencyNames).toEqual([
            '@layerzerolabs/protocol-starknet-v2',
        ]);
    });

    it('invalidates cached lockfile importers when the lockfile changes', async () => {
        const repo = createRepo('dependency-graph-cache-invalidation');
        const current = join(repo, 'apps', 'current');
        const depA = join(repo, 'packages', 'dep-a');
        const depB = join(repo, 'packages', 'dep-b');

        createPackage(current, '@layerzerolabs/current');
        createPackage(depA, '@layerzerolabs/dep-a');
        createPackage(depB, '@layerzerolabs/dep-b');
        writeLockfile(
            repo,
            `
  apps/current:
    dependencies:
      '@layerzerolabs/dep-a':
        specifier: workspace:*
        version: link:../../packages/dep-a

  packages/dep-a:
    devDependencies: {}
`,
        );

        const firstGraph = await resolveWorkspaceDependencyGraph({
            cwd: current,
            repoRoot: repo,
        });

        writeLockfile(
            repo,
            `
  apps/current:
    dependencies:
      '@layerzerolabs/dep-b':
        specifier: workspace:*
        version: link:../../packages/dep-b

  packages/dep-b:
    devDependencies: {}

  # Keep the rewritten lockfile size different so mtime+size invalidation is exercised.
`,
        );

        const secondGraph = await resolveWorkspaceDependencyGraph({
            cwd: current,
            repoRoot: repo,
        });

        expect(
            firstGraph.includedWorkspaceDependencies.map((dependency) => dependency.relativePath),
        ).toEqual(['packages/dep-a']);
        expect(
            secondGraph.includedWorkspaceDependencies.map((dependency) => dependency.relativePath),
        ).toEqual(['packages/dep-b']);
    });
});

describe(copyWorkspaceSources, () => {
    it('copies dependency sources and dist outputs while excluding the current package and heavyweight generated output directories', async () => {
        const repo = createRepo('workspace-source-copy');
        const current = join(repo, 'apps', 'current');
        const dep = join(repo, 'packages', 'dep');
        createPackage(current, '@layerzerolabs/current', {
            'src/index.ts': 'export const current = true',
            'target/deploy/current.so': 'compiled',
        });
        createPackage(dep, '@layerzerolabs/dep', {
            'src/index.ts': 'export const dep = true',
            'target/deploy/program.so': 'compiled',
            'target/wasm32v1-none/release/program.d': 'program.wasm: src/lib.rs',
            'target/wasm32v1-none/release/program.wasm': 'compiled wasm',
            'node_modules/pkg/index.js': 'module.exports = {}',
            'dist/index.js': 'module.exports = {}',
            'artifacts/contracts/Contract.json': '{}',
        });
        symlinkSync(
            '../../../../node_modules/.pnpm/linked-pkg@1.0.0/node_modules/linked-pkg',
            join(dep, 'node_modules', 'linked-pkg'),
        );
        symlinkSync('src/index.ts', join(dep, 'src-link.ts'));

        const dependencyGraph = {
            repoRoot: repo,
            packageRoot: current,
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

        const result = await copyWorkspaceSources({ dependencyGraph });
        const scopedRoot = trackScopedRoot(result.scopedRoot);

        expect(result.copiedWorkspaceDependencies).toHaveLength(1);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'src', 'index.ts'))).toBe(true);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'target', 'deploy'))).toBe(false);
        expect(
            existsSync(
                join(
                    scopedRoot,
                    'packages',
                    'dep',
                    'target',
                    'wasm32v1-none',
                    'release',
                    'program.d',
                ),
            ),
        ).toBe(true);
        expect(
            existsSync(
                join(
                    scopedRoot,
                    'packages',
                    'dep',
                    'target',
                    'wasm32v1-none',
                    'release',
                    'program.wasm',
                ),
            ),
        ).toBe(true);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'node_modules'))).toBe(true);
        expect(
            existsSync(join(scopedRoot, 'packages', 'dep', 'node_modules', 'pkg', 'index.js')),
        ).toBe(false);
        expect(
            lstatSync(
                join(scopedRoot, 'packages', 'dep', 'node_modules', 'linked-pkg'),
            ).isSymbolicLink(),
        ).toBe(true);
        expect(
            readlinkSync(join(scopedRoot, 'packages', 'dep', 'node_modules', 'linked-pkg')),
        ).toBe('../../../../node_modules/.pnpm/linked-pkg@1.0.0/node_modules/linked-pkg');
        expect(lstatSync(join(scopedRoot, 'packages', 'dep', 'src-link.ts')).isSymbolicLink()).toBe(
            true,
        );
        expect(readlinkSync(join(scopedRoot, 'packages', 'dep', 'src-link.ts'))).toBe(
            'src/index.ts',
        );
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'dist', 'index.js'))).toBe(true);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'artifacts'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'apps', 'current'))).toBe(false);
    });

    it('applies glob-compatible scoped-workspace prune patterns to dependency source copies', async () => {
        const repo = createRepo('workspace-source-pattern-copy');
        const current = join(repo, 'apps', 'current');
        const dep = join(repo, 'packages', 'dep');
        createPackage(current, '@layerzerolabs/current');
        createPackage(dep, '@layerzerolabs/dep', {
            'src/index.ts': 'export const dep = true',
            'README.md': '# dep',
            LICENSE: 'MIT',
            'sdk/client.ts': 'export const sdk = true',
            'scripts/dev.ts': 'export const dev = true',
            'tests/fixture.ts': 'export const secret = true',
            'node_modules/pkg/index.js': 'module.exports = {}',
            'programs/demo/src/lib.rs': 'pub fn process() {}',
            'programs/demo/tests/integration.rs': '#[test] fn it_works() {}',
            'target/deploy/program.so': 'compiled',
        });
        symlinkSync('../src/index.ts', join(dep, 'node_modules', 'dep-link'));

        const dependencyGraph = {
            repoRoot: repo,
            packageRoot: current,
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

        const result = await copyWorkspaceSources({
            dependencyGraph,
            prunePatterns: [
                ...DEFAULT_SOURCE_COPY_PATTERNS,
                '!**/*.md',
                '!**/LICENSE',
                '!sdk/**',
                '!scripts/**',
                '!tests/**',
                '!programs/**/tests/**',
            ],
        });
        const scopedRoot = trackScopedRoot(result.scopedRoot);

        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'src', 'index.ts'))).toBe(true);
        expect(existsSync(join(scopedRoot, 'apps', 'current'))).toBe(false);
        expect(
            existsSync(join(scopedRoot, 'packages', 'dep', 'programs', 'demo', 'src', 'lib.rs')),
        ).toBe(true);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'README.md'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'LICENSE'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'sdk'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'scripts'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'tests'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'programs', 'demo', 'tests'))).toBe(
            false,
        );
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'node_modules', 'pkg'))).toBe(false);
        expect(
            lstatSync(
                join(scopedRoot, 'packages', 'dep', 'node_modules', 'dep-link'),
            ).isSymbolicLink(),
        ).toBe(true);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'target'))).toBe(false);
    });

    it('tolerates identical package-local symlinks copied twice (nested workspace package layout)', async () => {
        const repo = createRepo('workspace-source-duplicate-symlink');
        const current = join(repo, 'apps', 'current');
        const parent = join(repo, 'apps', 'parent');
        const nested = join(parent, 'nested-pkg');
        createPackage(current, '@layerzerolabs/current');
        createPackage(parent, '@layerzerolabs/parent', {
            'src/index.ts': 'export const parent = true',
        });
        createPackage(nested, '@layerzerolabs/nested', {
            'src/index.ts': 'export const nested = true',
        });
        mkdirSync(join(nested, 'node_modules', '@layerzerolabs'), { recursive: true });
        symlinkSync(
            '../../../../../../tools/vm-tooling/vm-tooling-stellar',
            join(nested, 'node_modules', '@layerzerolabs', 'vm-tooling-stellar'),
        );
        // Parent tree includes the nested package directory on disk.
        mkdirSync(join(parent, 'node_modules', '@layerzerolabs'), { recursive: true });
        symlinkSync(
            '../../../../tools/vm-tooling/vm-tooling-stellar',
            join(parent, 'node_modules', '@layerzerolabs', 'vm-tooling-stellar'),
        );

        const dependencyGraph = {
            repoRoot: repo,
            packageRoot: current,
            packageRelativePath: 'apps/current',
            rootNodeModulesDependencyNames: [],
            includedWorkspaceDependencies: [
                {
                    name: '@layerzerolabs/parent',
                    importerRelativePath: 'apps/current',
                    relativePath: 'apps/parent',
                    absolutePath: parent,
                    version: 'link:../parent',
                },
                {
                    name: '@layerzerolabs/nested',
                    importerRelativePath: 'apps/parent',
                    relativePath: 'apps/parent/nested-pkg',
                    absolutePath: nested,
                    version: 'link:./nested-pkg',
                },
            ],
        };

        const result = await copyWorkspaceSources({ dependencyGraph });
        const scopedRoot = trackScopedRoot(result.scopedRoot);
        const nestedLink = join(
            scopedRoot,
            'apps',
            'parent',
            'nested-pkg',
            'node_modules',
            '@layerzerolabs',
            'vm-tooling-stellar',
        );
        expect(lstatSync(nestedLink).isSymbolicLink()).toBe(true);
        expect(readlinkSync(nestedLink)).toBe(
            '../../../../../../tools/vm-tooling/vm-tooling-stellar',
        );
    });

    it('falls back to default patterns when global prune patterns are empty', async () => {
        const repo = createRepo('workspace-source-package-pattern-copy');
        const current = join(repo, 'apps', 'current');
        const anchorDep = join(repo, 'packages', 'anchor-dep');
        const utilityDep = join(repo, 'packages', 'utility-dep');
        createPackage(current, '@layerzerolabs/current', {
            'src/index.ts': 'export const current = true',
            'tests/secret.ts': 'export const secret = true',
        });
        createPackage(anchorDep, '@layerzerolabs/anchor-dep', {
            'Anchor.toml': '[programs.localnet]\nanchor_dep = "11111111111111111111111111111111"',
            'programs/demo/Cargo.toml': '[package]\nname = "demo"',
            'programs/demo/src/lib.rs': 'pub fn process() {}',
            'programs/demo/tests/integration.rs': '#[test] fn it_works() {}',
        });
        createPackage(utilityDep, '@layerzerolabs/utility-dep', {
            'src/index.ts': 'export const utility = true',
        });

        const dependencyGraph = {
            repoRoot: repo,
            packageRoot: current,
            packageRelativePath: 'apps/current',
            rootNodeModulesDependencyNames: [],
            includedWorkspaceDependencies: [
                {
                    name: '@layerzerolabs/anchor-dep',
                    importerRelativePath: 'apps/current',
                    relativePath: 'packages/anchor-dep',
                    absolutePath: anchorDep,
                    version: 'link:../../packages/anchor-dep',
                },
                {
                    name: '@layerzerolabs/utility-dep',
                    importerRelativePath: 'apps/current',
                    relativePath: 'packages/utility-dep',
                    absolutePath: utilityDep,
                    version: 'link:../../packages/utility-dep',
                },
            ],
        };

        const result = await copyWorkspaceSources({
            dependencyGraph,
            prunePatterns: [],
            packagePrunePatterns: {
                'apps/current': ['src/**'],
                'packages/anchor-dep': [
                    'Anchor.toml',
                    'programs/*/Cargo.toml',
                    'programs/*/src/**',
                ],
            },
        });
        const scopedRoot = trackScopedRoot(result.scopedRoot);

        expect(existsSync(join(scopedRoot, 'apps', 'current'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'anchor-dep', 'Anchor.toml'))).toBe(true);
        expect(
            existsSync(
                join(scopedRoot, 'packages', 'anchor-dep', 'programs', 'demo', 'Cargo.toml'),
            ),
        ).toBe(true);
        expect(
            existsSync(
                join(scopedRoot, 'packages', 'anchor-dep', 'programs', 'demo', 'src', 'lib.rs'),
            ),
        ).toBe(true);
        expect(
            existsSync(join(scopedRoot, 'packages', 'anchor-dep', 'programs', 'demo', 'tests')),
        ).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'utility-dep', 'src', 'index.ts'))).toBe(
            true,
        );
    });
});

describe(createScopedWorkspace, () => {
    it('uses the unpruned source-copy fallback when no pruner is configured', async () => {
        const repo = createRepo('scoped-workspace-fallback');
        const current = join(repo, 'apps', 'current');
        const dep = join(repo, 'packages', 'dep');
        mkdirSync(join(repo, 'node_modules', '.pnpm'), { recursive: true });
        createPackage(current, '@layerzerolabs/current', {
            'src/index.ts': 'export const current = true',
        });
        createPackage(dep, '@layerzerolabs/dep', {
            'src/index.ts': 'export const dep = true',
        });
        writeLockfile(
            repo,
            `
  apps/current:
    dependencies:
      '@layerzerolabs/dep':
        specifier: workspace:*
        version: link:../../packages/dep

  packages/dep:
    devDependencies: {}
`,
        );

        const result = await createScopedWorkspace({ cwd: current });
        const scopedRoot = trackScopedRoot(result.scopedRoot);

        expect(result.prunerName).toBeUndefined();
        expect(result.diagnostics).toEqual([
            'No scoped-workspace pruner configured; using unpruned package-level source copy fallback.',
        ]);
        expect(result.copiedWorkspacePackageCount).toBe(1);
        expect(result.copiedWorkspacePackagePaths).toEqual({
            'packages/dep': realpathSync(dep),
        });
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'src', 'index.ts'))).toBe(true);
        expect(existsSync(join(scopedRoot, 'apps', 'current'))).toBe(false);
    });

    it('uses a configured pruner to filter dependency package copies', async () => {
        const repo = createRepo('scoped-workspace-pruner');
        const current = join(repo, 'apps', 'current');
        const dep = join(repo, 'packages', 'dep');
        const inputs: Parameters<ScopedWorkspacePruner['createPrunePlan']>[0][] = [];
        const pruner: ScopedWorkspacePruner = {
            name: 'test-pruner',
            createPrunePlan: async (input) => {
                inputs.push(input);
                return {
                    patterns: [],
                    packagePatterns: {
                        'apps/current': ['src/**'],
                        'packages/dep': [...DEFAULT_SOURCE_COPY_PATTERNS, '!tests/**'],
                    },
                    diagnostics: ['planned current package inputs'],
                };
            },
        };

        mkdirSync(join(repo, 'node_modules', '.pnpm'), { recursive: true });
        createPackage(current, '@layerzerolabs/current', {
            'src/index.ts': 'export const current = true',
            'tests/secret.ts': 'export const secret = true',
        });
        createPackage(dep, '@layerzerolabs/dep', {
            'src/index.ts': 'export const dep = true',
            'tests/fixture.ts': 'export const secret = true',
        });
        writeLockfile(
            repo,
            `
  apps/current:
    dependencies:
      '@layerzerolabs/dep':
        specifier: workspace:*
        version: link:../../packages/dep

  packages/dep:
    devDependencies: {}
`,
        );

        const result = await createScopedWorkspace({
            cwd: current,
            pruner,
        });
        const scopedRoot = trackScopedRoot(result.scopedRoot);

        expect(inputs).toHaveLength(1);
        const firstInput = inputs[0]!;

        expect(firstInput).toMatchObject({
            repoRoot: realpathSync(repo),
            packageRoot: realpathSync(current),
            packageRelativePath: 'apps/current',
            cwd: current,
        });
        expect(
            firstInput.dependencyGraph.includedWorkspaceDependencies.map(
                ({ relativePath }) => relativePath,
            ),
        ).toEqual(['packages/dep']);
        expect(result.prunerName).toBe('test-pruner');
        expect(result.diagnostics).toEqual(['planned current package inputs']);
        expect(result.copiedWorkspacePackageCount).toBe(1);
        expect(result.copiedWorkspacePackagePaths).toEqual({
            'packages/dep': realpathSync(dep),
        });
        expect(existsSync(join(scopedRoot, 'apps', 'current'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'src', 'index.ts'))).toBe(true);
        expect(existsSync(join(scopedRoot, 'packages', 'dep', 'tests'))).toBe(false);
    });

    it('uses default dependency copies for pruned packages without package-specific patterns', async () => {
        const repo = createRepo('scoped-workspace-empty-global-patterns');
        const current = join(repo, 'apps', 'current');
        const prunedDep = join(repo, 'packages', 'pruned-dep');
        const defaultDep = join(repo, 'packages', 'default-dep');
        const pruner: ScopedWorkspacePruner = {
            name: 'test-pruner',
            createPrunePlan: async () => ({
                patterns: [],
                packagePatterns: {
                    'packages/pruned-dep': ['src/**'],
                },
            }),
        };

        mkdirSync(join(repo, 'node_modules', '.pnpm'), { recursive: true });
        createPackage(current, '@layerzerolabs/current', {
            'src/index.ts': 'export const current = true',
        });
        createPackage(prunedDep, '@layerzerolabs/pruned-dep', {
            'src/index.ts': 'export const pruned = true',
            'tests/fixture.ts': 'export const fixture = true',
        });
        createPackage(defaultDep, '@layerzerolabs/default-dep', {
            'src/index.ts': 'export const defaultDep = true',
        });
        writeLockfile(
            repo,
            `
  apps/current:
    dependencies:
      '@layerzerolabs/pruned-dep':
        specifier: workspace:*
        version: link:../../packages/pruned-dep
      '@layerzerolabs/default-dep':
        specifier: workspace:*
        version: link:../../packages/default-dep

  packages/default-dep:
    devDependencies: {}

  packages/pruned-dep:
    devDependencies: {}
`,
        );

        const result = await createScopedWorkspace({
            cwd: current,
            pruner,
        });
        const scopedRoot = trackScopedRoot(result.scopedRoot);

        expect(existsSync(join(scopedRoot, 'packages', 'pruned-dep', 'src', 'index.ts'))).toBe(
            true,
        );
        expect(existsSync(join(scopedRoot, 'packages', 'pruned-dep', 'tests'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'packages', 'default-dep', 'src', 'index.ts'))).toBe(
            true,
        );
    });
});

describe(copyRootNodeModulesSymlinks, () => {
    it('copies only selected root dependency symlinks without copying dependency contents', async () => {
        const repo = createRepo('node-modules-symlinks');
        const scopedRoot = join(TMP, 'scoped-node-modules-symlinks');
        const dep = join(repo, 'apps', 'oapp-app', 'contracts', 'solana');

        createPackage(dep, '@layerzerolabs/oapp-solana-impl');
        mkdirSync(join(repo, 'node_modules', '.pnpm'), { recursive: true });
        mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
        mkdirSync(join(repo, 'node_modules', '@types'), { recursive: true });
        mkdirSync(join(repo, 'node_modules', '@layerzerolabs'), { recursive: true });
        writeFileSync(join(repo, 'node_modules', '.bin', 'real-file'), 'do not copy');
        mkdirSync(join(scopedRoot, 'apps', 'oapp-app', 'contracts', 'solana'), { recursive: true });
        symlinkSync('.pnpm/eslint@1.0.0/node_modules/eslint', join(repo, 'node_modules', 'eslint'));
        symlinkSync(
            '../.pnpm/typescript@1.0.0/node_modules/typescript/bin/tsc',
            join(repo, 'node_modules', '.bin', 'tsc'),
        );
        symlinkSync(
            '../.pnpm/@types+node@1.0.0/node_modules/@types/node',
            join(repo, 'node_modules', '@types', 'node'),
        );
        symlinkSync(
            '../../apps/oapp-app/contracts/solana',
            join(repo, 'node_modules', '@layerzerolabs', 'oapp-solana-impl'),
        );
        symlinkSync('../..', join(repo, 'node_modules', '@layerzerolabs', 'whole-repo-link'));

        const result = await copyRootNodeModulesSymlinks({
            repoRoot: repo,
            scopedRoot,
            dependencyNames: ['@layerzerolabs/oapp-solana-impl', '@types/node', 'eslint'],
        });

        expect(result.nodeModulesPath).toBe(join(scopedRoot, 'node_modules'));
        expect(result.symlinks).toEqual([
            '@layerzerolabs/oapp-solana-impl',
            '@types/node',
            'eslint',
        ]);
        expect(readlinkSync(join(scopedRoot, 'node_modules', 'eslint'))).toBe(
            '.pnpm/eslint@1.0.0/node_modules/eslint',
        );
        expect(lstatSync(join(scopedRoot, 'node_modules', '.pnpm')).isDirectory()).toBe(true);
        expect(existsSync(join(scopedRoot, 'node_modules', '.bin', 'real-file'))).toBe(false);
        expect(existsSync(join(scopedRoot, 'node_modules', '.bin', 'tsc'))).toBe(false);
        expect(lstatSync(join(scopedRoot, 'node_modules', '@types', 'node')).isSymbolicLink()).toBe(
            true,
        );
        expect(
            lstatSync(
                join(scopedRoot, 'node_modules', '@layerzerolabs', 'oapp-solana-impl'),
            ).isSymbolicLink(),
        ).toBe(true);
        expect(
            readlinkSync(join(scopedRoot, 'node_modules', '@layerzerolabs', 'oapp-solana-impl')),
        ).toBe('../../apps/oapp-app/contracts/solana');
        expect(
            existsSync(join(scopedRoot, 'node_modules', '@layerzerolabs', 'whole-repo-link')),
        ).toBe(false);
    });
});

describe(getPnpmVirtualStoreMount, () => {
    it('describes a read-only .pnpm mount without requiring root node_modules copy', () => {
        expect(getPnpmVirtualStoreMount('/repo')).toEqual({
            hostPath: '/repo/node_modules/.pnpm',
            containerPath: '/workspace/node_modules/.pnpm',
            readOnly: true,
        });
    });
});
