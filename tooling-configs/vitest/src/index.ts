import type { ViteUserConfig } from 'vitest/config';
import { defineConfig as defineVitestConfig, mergeConfig } from 'vitest/config';

const typecheck = {
    enabled: true,
    include: ['**/*.test.ts{,x}'],
    tsconfig: 'tsconfig.test.json',
};

export const defineConfig = ({ test, ...config }: ViteUserConfig = {}): ViteUserConfig =>
    mergeConfig(
        defineVitestConfig({
            test: {
                passWithNoTests: true,
                typecheck,
                watch: false,
            },
        }),
        defineVitestConfig({
            ...config,
            test: {
                ...test,
                projects: test?.projects
                    ? test.projects.map((project) =>
                          typeof project === 'string' ||
                          typeof project === 'function' ||
                          project instanceof Promise
                              ? project
                              : {
                                    ...project,
                                    test: {
                                        ...project.test,
                                        typecheck,
                                    },
                                },
                      )
                    : undefined,
            },
        }),
    );
