import { defineConfig } from '@layerzerolabs/vitest-configuration';

export default defineConfig({
    test: {
        globals: true,
        include: ['test/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/open-api/**'],
        },
    },
});
