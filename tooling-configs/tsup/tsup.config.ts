import { defineConfig } from 'tsup';

export default defineConfig({
    format: 'esm',
    outDir: 'dist',
    target: 'ES2023',
});
