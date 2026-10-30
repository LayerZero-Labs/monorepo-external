import { join } from 'node:path';
import pLimit from 'p-limit';

import { pathExists } from '@layerzerolabs/common-node-utils';
import {
    DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS,
    type ScopedWorkspacePruner,
} from '@layerzerolabs/vm-tooling';

// A Scarb package can bundle a TypeScript SDK at its root (src/ -> dist/) next to nested Cairo
// crates. Drop only that top-level TS layer; crates like layerzero/src and libs/*/src stay.
const SCARB_PACKAGE_PATTERNS = [
    '**/*',
    '!**/tests/**',
    '!dist/**',
    '!src/**',
    ...DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS,
] as const;

export const createStarknetScopedWorkspacePruner = (): ScopedWorkspacePruner => ({
    name: 'starknet',
    createPrunePlan: async ({ dependencyGraph }) => {
        const packagePatterns: Record<string, readonly string[]> = {};
        const limit = pLimit(10);

        await Promise.all(
            dependencyGraph.includedWorkspaceDependencies.map((dependency) =>
                limit(async () => {
                    // A root Scarb.toml marks a workspace dependency whose Cairo sources can be
                    // referenced by Scarb path dependencies.
                    if (await pathExists(join(dependency.absolutePath, 'Scarb.toml'))) {
                        packagePatterns[dependency.relativePath] = SCARB_PACKAGE_PATTERNS;
                    }
                }),
            ),
        );

        const includedPackageCount = Object.keys(packagePatterns).length;

        // Starknet contracts use Scarb path dependencies into node_modules. For example, the OFT
        // Scarb.toml imports @layerzerolabs/protocol-v2-starknet-contracts/layerzero. Keep the
        // Scarb packages behind those paths through packagePatterns, and skip every other
        // workspace dependency.
        return {
            patterns: ['!**/**'],
            packagePatterns,
            diagnostics: [
                `Starknet scoped-workspace pruner selected ${includedPackageCount} Scarb dependency package(s).`,
            ],
        };
    },
});
