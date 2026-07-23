import { describe, expect, it } from 'vitest';

import { createExcludeWorkspaceDependencySourcesPruner } from '../exclude-workspace-dependency-sources-pruner';

describe(createExcludeWorkspaceDependencySourcesPruner, () => {
    it('excludes workspace dependency sources and reports the excluded package count', async () => {
        const pruner = createExcludeWorkspaceDependencySourcesPruner('test-vm');

        const plan = await pruner.createPrunePlan({
            repoRoot: '/repo',
            packageRoot: '/repo/apps/current',
            packageRelativePath: 'apps/current',
            cwd: '/repo/apps/current',
            dependencyGraph: {
                repoRoot: '/repo',
                packageRoot: '/repo/apps/current',
                packageRelativePath: 'apps/current',
                rootNodeModulesDependencyNames: [],
                includedWorkspaceDependencies: [
                    {
                        name: '@layerzerolabs/dep-a',
                        importerRelativePath: 'apps/current',
                        relativePath: 'packages/dep-a',
                        absolutePath: '/repo/packages/dep-a',
                        version: 'link:../../packages/dep-a',
                    },
                    {
                        name: '@layerzerolabs/dep-b',
                        importerRelativePath: 'apps/current',
                        relativePath: 'packages/dep-b',
                        absolutePath: '/repo/packages/dep-b',
                        version: 'link:../../packages/dep-b',
                    },
                ],
            },
        });

        expect(pruner.name).toBe('test-vm');
        expect(plan.patterns).toEqual(['!**/**']);
        expect(plan.packagePatterns).toEqual({});
        expect(plan.diagnostics).toEqual([
            'test-vm scoped-workspace pruner excluded source files from 2 workspace dependency package(s).',
        ]);
    });
});
