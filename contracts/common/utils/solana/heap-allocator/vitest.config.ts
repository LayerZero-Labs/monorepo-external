import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/demo.test.ts'],
        bail: 1,
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 240_000,
    },
});
