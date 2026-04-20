import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Global setup runs ONCE before all test files
        globalSetup: './test/suites/globalSetup.ts',
        // Run tests sequentially to avoid conflicts with shared blockchain state
        sequence: {
            concurrent: false,
        },
        // Longer timeouts for blockchain operations
        testTimeout: 120000,
        hookTimeout: 240000,
        // Don't isolate test files - they share the same localnet
        isolate: false,
        // Run test files sequentially
        fileParallelism: false,
        // Stop on first failure
        bail: 1,
    },
});
