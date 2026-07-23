import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS } from '@layerzerolabs/vm-tooling';

import { createStellarScopedWorkspacePruner } from '../src/scoped-workspace-pruner';

const repoRoots: string[] = [];

afterAll(() => {
    for (const repoRoot of repoRoots) {
        rmSync(repoRoot, { recursive: true, force: true });
    }
});

const createDependency = async (root: string, relativePath: string, hasCargoToml = false) => {
    const absolutePath = join(root, relativePath);
    await mkdir(absolutePath, { recursive: true });

    if (hasCargoToml) {
        await writeFile(join(absolutePath, 'Cargo.toml'), '[package]\nname = "dep"\n');
    }

    return {
        name: `@layerzerolabs/${relativePath.replaceAll('/', '-')}`,
        importerRelativePath: 'apps/current',
        relativePath,
        absolutePath,
        version: `link:../../${relativePath}`,
    };
};

describe(createStellarScopedWorkspacePruner, () => {
    it('selects release artifacts, full bindings source, and ignores unrelated dependencies', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'stellar-scoped-workspace-pruner-'));
        repoRoots.push(repoRoot);
        const cargoDependency = await createDependency(repoRoot, 'contracts/stellar-oft', true);
        const bindingsDependency = {
            ...(await createDependency(repoRoot, 'packages/vms/stellar/ts-bindings-gen', true)),
            name: '@layerzerolabs/stellar-ts-bindings-gen',
        };
        const tsDependency = await createDependency(repoRoot, 'tools/vm-utils/stellar');

        const pruner = createStellarScopedWorkspacePruner();
        const plan = await pruner.createPrunePlan({
            repoRoot,
            packageRoot: join(repoRoot, 'apps/current'),
            packageRelativePath: 'apps/current',
            cwd: join(repoRoot, 'apps/current'),
            dependencyGraph: {
                repoRoot,
                packageRoot: join(repoRoot, 'apps/current'),
                packageRelativePath: 'apps/current',
                rootNodeModulesDependencyNames: [],
                includedWorkspaceDependencies: [cargoDependency, bindingsDependency, tsDependency],
            },
        });

        expect(plan.patterns).toEqual(['!**/**']);
        expect(plan.packagePatterns).toEqual({
            'contracts/stellar-oft': [
                'target/wasm32v1-none/release/*.d',
                'target/wasm32v1-none/release/*.wasm',
                '.artifacts/**/*.wasm',
            ],
            'packages/vms/stellar/ts-bindings-gen': [
                '**/*',
                ...DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS,
            ],
        });
        expect(plan.diagnostics).toEqual([
            'Stellar scoped-workspace pruner selected files from 2 workspace dependency package(s).',
        ]);
    });
});
