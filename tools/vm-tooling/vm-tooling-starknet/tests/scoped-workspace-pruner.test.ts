import { rmSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS } from '@layerzerolabs/vm-tooling';

import { createStarknetScopedWorkspacePruner } from '../src/scoped-workspace-pruner';

const repoRoots: string[] = [];

afterAll(() => {
    for (const repoRoot of repoRoots) {
        rmSync(repoRoot, { recursive: true, force: true });
    }
});

const createDependency = async (root: string, relativePath: string, hasScarbToml = false) => {
    const absolutePath = join(root, relativePath);
    await mkdir(absolutePath, { recursive: true });

    if (hasScarbToml) {
        await writeFile(join(absolutePath, 'Scarb.toml'), '[package]\nname = "dep"\n');
    }

    return {
        name: `@layerzerolabs/${relativePath.replaceAll('/', '-')}`,
        importerRelativePath: 'apps/current',
        relativePath,
        absolutePath,
        version: `link:../../${relativePath}`,
    };
};

describe(createStarknetScopedWorkspacePruner, () => {
    it('preserves Scarb package inputs while ignoring other dependency sources', async () => {
        const repoRoot = await mkdtemp(join(tmpdir(), 'starknet-scoped-workspace-pruner-'));
        repoRoots.push(repoRoot);
        const scarbDependency = await createDependency(
            repoRoot,
            'contracts/protocol/starknet',
            true,
        );
        const tsDependency = await createDependency(
            repoRoot,
            'tools/vm-utils/starknet/build-utils',
        );

        const pruner = createStarknetScopedWorkspacePruner();
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
                includedWorkspaceDependencies: [scarbDependency, tsDependency],
            },
        });

        expect(plan.patterns).toEqual(['!**/**']);
        expect(plan.packagePatterns).toEqual({
            'contracts/protocol/starknet': [
                '**/*',
                '!**/tests/**',
                '!dist/**',
                '!src/**',
                ...DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS,
            ],
        });
        expect(plan.diagnostics).toEqual([
            'Starknet scoped-workspace pruner selected 1 Scarb dependency package(s).',
        ]);
    });
});
