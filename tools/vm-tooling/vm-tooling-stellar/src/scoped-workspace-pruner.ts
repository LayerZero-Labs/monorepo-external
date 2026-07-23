import { join } from 'node:path';
import pLimit from 'p-limit';

import { pathExists } from '@layerzerolabs/common-node-utils';
import {
    DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS,
    type ScopedWorkspacePruner,
} from '@layerzerolabs/vm-tooling';

export const createStellarScopedWorkspacePruner = (): ScopedWorkspacePruner => ({
    name: 'stellar',
    createPrunePlan: async ({ dependencyGraph }) => {
        const packagePatterns: Record<string, readonly string[]> = {};
        const limit = pLimit(10);

        await Promise.all(
            dependencyGraph.includedWorkspaceDependencies.map((dependency) =>
                limit(async () => {
                    if (dependency.name === '@layerzerolabs/stellar-ts-bindings-gen') {
                        packagePatterns[dependency.relativePath] = [
                            '**/*',
                            ...DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS,
                        ];
                        return;
                    }

                    // Stellar Rust sources are vendored into the current package's dependencies/
                    // directory by build-utils-rust before lz-tool runs. Workspace dependency
                    // packages only need their wasm outputs for TS bindings generation:
                    // - target/.../release: cargo/stellar-cli release builds
                    // - .artifacts: SEP-58 verifiable builds (e.g. onesig / protocol stellar SDKs)
                    if (await pathExists(join(dependency.absolutePath, 'Cargo.toml'))) {
                        packagePatterns[dependency.relativePath] = [
                            'target/wasm32v1-none/release/*.d',
                            'target/wasm32v1-none/release/*.wasm',
                            '.artifacts/**/*.wasm',
                        ];
                    }
                }),
            ),
        );

        const includedPackageCount = Object.keys(packagePatterns).length;

        return {
            patterns: ['!**/**'],
            packagePatterns,
            diagnostics: [
                `Stellar scoped-workspace pruner selected files from ${includedPackageCount} workspace dependency package(s).`,
            ],
        };
    },
});
