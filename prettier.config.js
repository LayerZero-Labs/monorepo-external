// prettier.config.js, .prettierrc.js, prettier.config.cjs, or .prettierrc.cjs

/**
 * @see https://prettier.io/docs/configuration
 * @type {import("prettier").Config}
 */
const config = {
    semi: true,
    trailingComma: 'all',
    singleQuote: true,
    printWidth: 100,
    tabWidth: 4,
    bracketSpacing: true,
    arrowParens: 'always',
    plugins: [
        'prettier-plugin-tailwindcss',
        'prettier-plugin-packagejson',
        'prettier-plugin-solidity',
    ],
    overrides: [
        {
            files: ['*.yaml', '*.yml'],
            options: {
                bracketSpacing: true,
                printWidth: 120,
                tabWidth: 2,
                singleQuote: true,
                useTabs: false,
            },
        },
        {
            files: '*.sol',
            options: {
                bracketSpacing: true,
                printWidth: 120,
                tabWidth: 4,
                useTabs: false,
                singleQuote: false,
            },
        },
        {
            files: 'package.json',
            options: {
                tabWidth: 4,
            },
        },
        {
            files: '*.jsonc',
            options: {
                trailingComma: 'none',
            },
        },
    ],
};

module.exports = config;
