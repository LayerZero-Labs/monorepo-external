import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globalSetup: ['./tests/global-setup.ts'],
        include: ['tests/*.test.ts'],
        testTimeout: 300_000,
        hookTimeout: 300_000,
        bail: 1,
        pool: 'forks',
        fileParallelism: true,
    },
});
