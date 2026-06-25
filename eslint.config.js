import baseConfig from '@layerzerolabs/eslint-configuration/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...baseConfig,
    {
        files: [
            'tools/truesight/src/**/*.{ts,tsx}',
            // The legacy truesight is a Create React App tool whose components are
            // authored as JSX inside plain .js files; enable JSX parsing for them.
            'legacy/offchain-monorepo/tools/truesight/src/**/*.{ts,tsx,js,jsx}',
        ],
        languageOptions: {
            parserOptions: {
                ecmaFeatures: {
                    jsx: true,
                },
            },
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
