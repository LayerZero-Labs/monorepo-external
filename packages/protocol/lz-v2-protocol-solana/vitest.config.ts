import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        testTimeout: 120_000,
        // Ceiling for the whole beforeAll: the boot poll loop (~180s, see start()) plus the
        // writeProgram loop that loads the protocol .so over RPC. A boot that never answers is
        // caught by the poll loop's "failed to start", not this; 240s just leaves headroom for a
        // slow cold pull (or amd64 emulation on Apple Silicon) plus the program load.
        hookTimeout: 240_000,

        // Run tests serially to avoid Docker conflicts
        pool: 'forks',
        maxWorkers: 1,
        isolate: false,
    },
});
