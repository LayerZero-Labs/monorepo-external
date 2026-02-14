import { defineConfig } from 'tsup';

export default defineConfig({
    // Build output configuration
    format: ['cjs', 'esm'],
    outDir: 'dist',
    target: 'ES2023',
});
