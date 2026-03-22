import baseConfig from '@layerzerolabs/eslint-configuration/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...baseConfig,
    {
        files: ['tools/truesight/src/**/*.{ts,tsx}'],
        languageOptions: {
            globals: {
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                fetch: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                console: 'readonly',
                HTMLElement: 'readonly',
                React: 'readonly',
            },
        },
    },
];
