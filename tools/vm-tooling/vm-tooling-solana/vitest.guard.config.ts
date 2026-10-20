import { defineConfig } from '@layerzerolabs/vitest-configuration';

export default defineConfig({
    test: {
        include: ['docker/solana/sbf-guard/test/**/*.test.ts'],
    },
});
