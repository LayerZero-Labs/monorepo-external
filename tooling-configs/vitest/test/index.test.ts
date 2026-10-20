import { describe, expect, it } from 'vitest';

import { defineConfig } from '../src/index.js';

describe(defineConfig, () => {
    it('references the static typecheck tsconfig', () => {
        expect(defineConfig().test?.typecheck?.tsconfig).toBe('tsconfig.test.json');
    });

    it('type-checks both runtime and type-only test files', () => {
        expect(defineConfig().test?.typecheck?.include).toEqual([
            '**/*.test.ts{,x}',
            '**/*.test-d.ts{,x}',
        ]);
    });

    it('merges custom config', () => {
        const config = defineConfig({
            test: {
                sequence: { concurrent: true },
            },
        });

        expect(config.test?.typecheck?.tsconfig).toBe('tsconfig.test.json');
        expect(config.test?.sequence?.concurrent).toBe(true);
    });
});
