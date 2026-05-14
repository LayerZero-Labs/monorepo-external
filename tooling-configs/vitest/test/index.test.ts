import { describe, expect, it } from 'vitest';

import { defineConfig } from '../src/index.js';

describe(defineConfig, () => {
    it('references the static typecheck tsconfig', () => {
        expect(defineConfig().test?.typecheck?.tsconfig).toBe('tsconfig.test.json');
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
