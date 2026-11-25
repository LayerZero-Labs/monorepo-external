import baseConfig from '@layerzerolabs/eslint-configuration/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...baseConfig,
    {
        ignores: ['typechain-types/**', 'scripts/**'],
    },
    {
        files: ['**/test/**/*.ts'],
        languageOptions: {
            globals: {
                describe: 'readonly',
                it: 'readonly',
                before: 'readonly',
                after: 'readonly',
                beforeEach: 'readonly',
                afterEach: 'readonly',
            },
        },
    },
    {
        files: ['hardhat.config.ts'],
        rules: {
            'turbo/no-undeclared-env-vars': 'off',
        },
    },
];
