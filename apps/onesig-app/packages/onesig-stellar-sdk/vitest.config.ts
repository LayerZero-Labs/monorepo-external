import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Integration tests spin up a local Stellar docker stack, so give them more than 60s.
        testTimeout: 240000,
        hookTimeout: 240000,
    },
});
