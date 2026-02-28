import typescriptEslint from '@typescript-eslint/eslint-plugin';
import onlyWarn from 'eslint-plugin-only-warn';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import * as espree from 'espree';
import js from '@eslint/js';
import turboConfig from 'eslint-config-turbo/flat';
import prettierConfig from 'eslint-config-prettier/flat';

// Rules that work for both JavaScript and TypeScript
const commonRules = {
    'no-constant-condition': 'off',
    'no-empty': 'off',
    'no-unused-vars': 'off',
    'no-redeclare': 'off',

    'simple-import-sort/imports': [
        'warn',
        {
            groups: [
                ['^\\u0000'],
                ['^@?\\w'],
                ['^@(layerzerolabs|ui-internal|web3-ui-internal)/'],
                ['^@/'],
                ['^\\.'],
            ],
        },
    ],

    'simple-import-sort/exports': 'warn',
};

// Type-aware rules that require parserOptions.project to be true
const typeAwareRules = {
    '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
            prefer: 'type-imports',
        },
    ],

    '@typescript-eslint/no-floating-promises': 'warn',
};

// Rules that require TypeScript type information (only for .ts/.tsx files)
const typescriptRules = {
    '@typescript-eslint/no-unused-vars': [
        'warn',
        {
            argsIgnorePattern: '^_',
            varsIgnorePattern: '^_',
            caughtErrors: 'all',
            caughtErrorsIgnorePattern: '^_',
        },
    ],

    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-interface': 'off',
};

export default [
    // ESLint recommended rules
    js.configs.recommended,

    // Turbo config
    ...turboConfig,

    // Prettier config
    prettierConfig,

    // Base configuration (common rules for all files)
    {
        plugins: {
            '@typescript-eslint': typescriptEslint,
            'only-warn': onlyWarn,
            'simple-import-sort': simpleImportSort,
        },

        languageOptions: {
            globals: {
                ...globals.node,
            },
        },

        rules: {
            ...commonRules,
        },
    },

    // Global ignores
    {
        ignores: [
            '**/node_modules/',
            '**/dist/',
            '**/build/',
            '**/.next/',
            '**/.turbo/',
            '**/.storybook/',
            '**/coverage/',
            '**/.eslintrc.*',
            '**/eslint.config.*',
            '**/tsup.config.*',
            '**/vitest.config.ts',
            '**/wagmi*.config.ts',
            '**/cdk.out/',
            '**/bin/',
            '**/vm-tooling/docker/',
            '**/tooling-configs/eslint/**',
            '**/*.hbs',
            '**/generated/**',
            '**/generated-artifacts/**',
            '**/generated-tron/**',
            '**/generated-tron-artifacts/**',
            '**/generated-zk/**',
            '**/generated-zk-artifacts/**',
            '**/generated_artifacts/**',
            '**/contracts/target/**', // Cairo/Scarb build artifacts
        ],
    },

    // TypeScript files
    {
        files: ['**/*.ts', '**/*.tsx'],

        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: true,
            },
        },
        rules: {
            ...typescriptRules,
            ...typeAwareRules,
        },
    },

    // JavaScript files
    {
        files: ['**/*.js', '**/*.jsx'],

        languageOptions: {
            parser: espree,
            ecmaVersion: 'latest',
            sourceType: 'module',
            parserOptions: {},
        },
    },

    // Config files and CommonJS files
    {
        files: ['**/*.config.{js,ts}', '**/*.cjs'],

        languageOptions: {
            globals: {
                ...globals.node,
            },

            parserOptions: {
                project: null,
            },
        },

        rules: {
            'no-undef': 'off',
            '@typescript-eslint/no-var-requires': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/consistent-type-imports': 'off',
        },
    },

    // Test files
    {
        files: ['**/*.test.*', '**/*.spec.*', '**/tests/**', '**/test/**'],

        languageOptions: {
            parserOptions: {
                project: null,
            },
        },

        rules: {
            'no-console': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            '@typescript-eslint/consistent-type-imports': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            'turbo/no-undeclared-env-vars': 'off',
        },
    },
];
