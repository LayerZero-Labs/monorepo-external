import { configDefaults } from 'vitest/config';

import { defineConfig } from '@layerzerolabs/vitest-configuration';

export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, 'docker/solana/sbf-guard/**'],
        sequence: { concurrent: true },
    },
});
