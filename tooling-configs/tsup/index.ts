// import { execSync } from 'child_process'
import { execSync } from 'child_process';
import type { Options } from 'tsup';

const baseConfig: Partial<Options> = {
    entry: ['src/**/*.ts', 'src/**/*.tsx'],
    // Build output configuration
    format: ['cjs', 'esm'],
    outDir: 'dist',
    target: 'ES2023',

    // Source maps
    sourcemap: true,

    // Build optimization options
    clean: false,
    splitting: true,
    treeshake: true,
    shims: true,
    esbuildOptions(opts) {
        opts.chunkNames = '[hash]';
    },
};

export const createPackageTsupConfig = (options: Partial<Options> = {}): Partial<Options> => ({
    ...baseConfig,
    // We disable tsup's dts generation in favor of tsc to get proper declaration maps
    // This enables "Go to Definition" to jump to source files instead of declaration files
    dts: false,
    onSuccess: async () => {
        // By default, tsc skips emitting declaration files if it thinks they're up-to-date
        // This causes issues during subsequent builds where .d.ts.map files aren't regenerated
        // Using --build with --force ensures declaration files are always regenerated
        // regardless of whether the dist folder exists or what files it contains
        execSync('tsc --build --force --emitDeclarationOnly --declaration --declarationMap', {
            stdio: 'inherit',
        });
    },
    ...options,
});
