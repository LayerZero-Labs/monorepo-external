import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        dir: 'test',
        include: ['**/*.test.ts'],
        typecheck: {
            enabled: true,
            include: ['**/*.test.ts'],
            tsconfig: './tsconfig.json',
        },
    },
});
