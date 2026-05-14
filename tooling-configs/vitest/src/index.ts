import type { ViteUserConfig } from 'vitest/config';
import { defineConfig as defineVitestConfig, mergeConfig } from 'vitest/config';

export const defineConfig = (config: ViteUserConfig = {}): ViteUserConfig =>
    mergeConfig(
        defineVitestConfig({
            test: {
                passWithNoTests: true,
                typecheck: {
                    enabled: true,
                    include: ['**/*.test.ts{,x}'],
                    tsconfig: 'tsconfig.test.json',
                },
                watch: false,
            },
        }),
        defineVitestConfig(config),
    );
