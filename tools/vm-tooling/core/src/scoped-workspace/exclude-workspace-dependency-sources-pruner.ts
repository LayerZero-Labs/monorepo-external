import type { ScopedWorkspacePruner } from './types';

/**
 * Create a pruner for containerized VM tool invocations that do not need source files from other
 * workspace packages.
 *
 * Only workspace dependency source copies are excluded. The current package remains bind-mounted,
 * and the repo-shaped directory structure, root node_modules symlinks, and pnpm virtual-store mount
 * are preserved for tool execution.
 */
export const createExcludeWorkspaceDependencySourcesPruner = (
    name: string,
): ScopedWorkspacePruner => ({
    name,
    createPrunePlan: async ({ dependencyGraph }) => {
        const excludedPackageCount = dependencyGraph.includedWorkspaceDependencies.length;

        return {
            patterns: ['!**/**'],
            packagePatterns: {},
            diagnostics: [
                `${name} scoped-workspace pruner excluded source files from ${excludedPackageCount} workspace dependency package(s).`,
            ],
        };
    },
});
