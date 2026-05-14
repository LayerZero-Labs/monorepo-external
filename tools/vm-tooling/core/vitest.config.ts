import { defineConfig } from '@layerzerolabs/vitest-configuration';

export default defineConfig({
    test: {
        sequence: { concurrent: true },
    },
});
