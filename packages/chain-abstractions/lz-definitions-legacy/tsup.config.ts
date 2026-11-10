import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    outExtension: ({ format }) => ({
        js: format === 'cjs' ? '.cjs' : '.mjs',
    }),
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: true,
    treeshake: true,
    shims: true,
});
