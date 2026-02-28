import baseConfig from '@layerzerolabs/eslint-configuration/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...baseConfig,
    {
        ignores: ['target/**', 'build/**', 'src/generated/**', 'scripts/'],
    },
];
