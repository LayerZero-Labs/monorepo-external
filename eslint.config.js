import baseConfig from '@layerzerolabs/eslint-configuration/base';

/** @type {import("eslint").Linter.Config[]} */
export default [
    ...baseConfig,
    {
        // Docker-only (not a pnpm package). `pr:lint` diffs these .ts files and
        // type-aware lint uses `parserOptions.project: true`. SDK types live in
        // gitignored `docker/node_modules` (host `alarm-investigator:ide-install` or
        // image `npm ci`), not `pnpm i`, so a clean `pr:lint` still fails.
        ignores: ['tools/alarm-investigator/**'],
    },
    {
        files: [
            'tools/truesight/src/**/*.{ts,tsx}',
            // The legacy truesight is a Create React App tool whose components are
            // authored as JSX inside plain .js files; enable JSX parsing for them.
            'migrated/offchain-monorepo/tools/truesight/src/**/*.{ts,tsx,js,jsx}',
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
