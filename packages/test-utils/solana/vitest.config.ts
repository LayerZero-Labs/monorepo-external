import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/*.test.ts'],
        // Build the surfpool base snapshot (extract protocol .so + buildBaseSnapshot) once before
        // any test file. Without this, base.json is never generated and startValidator boots
        // --snapshot against a missing file.
        globalSetup: ['./src/global-setup.ts'],
        testTimeout: 120_000,
        // Must exceed startValidator's startupTimeoutSeconds (180s): a cold beforeAll boot polls
        // waitForRpc up to that budget, plus writeProgram/airdrop, so a 120s hook would be killed
        // before the boot's own budget expires.
        hookTimeout: 240_000,
    },
});
