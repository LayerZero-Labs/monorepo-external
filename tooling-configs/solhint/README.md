# @layerzerolabs/solhint-configuration

Shared [Solhint](https://github.com/protofire/solhint) configuration for Solidity projects across the LayerZero monorepo.

## Overview

This package provides a standardized Solhint configuration that extends `solhint:recommended` with customizations optimized for LayerZero's Solidity coding standards. Due to limitations in Solhint's package resolution, this configuration is designed to be loaded via `require()` in a local `solhint.config.js` file.

## Setup (Required Steps)

1. **Add the package to your `devDependencies`:**

```json
{
    "devDependencies": {
        "@layerzerolabs/solhint-configuration": "workspace:*",
        "solhint": "catalog:"
    }
}
```

2. **Create `solhint.config.js` in your project root:**

```javascript
const baseConfig = require('@layerzerolabs/solhint-configuration');

module.exports = baseConfig;
```

3. **Add lint script with explicit `--config` flag:**

```json
{
    "scripts": {
        "lint": "solhint --config solhint.config.js 'contracts/**/*.sol' --fix"
    }
}
```

### Overriding Rules

If you need project-specific rule overrides:

```javascript
const baseConfig = require('@layerzerolabs/solhint-configuration');

module.exports = {
    ...baseConfig,
    rules: {
        ...baseConfig.rules,
        'compiler-version': ['error', '0.8.20'],
        'max-line-length': ['error', 120],
    },
};
```

## Why This Approach?

### The Problem with Solhint's `extends`

Solhint's configuration resolution has a limitation when handling scoped npm packages. When you use:

```json
{
    "extends": "@layerzerolabs/solhint-configuration"
}
```

Solhint's config loader (see [config-file.js](https://github.com/protofire/solhint/blob/master/lib/config/config-file.js#L62-L69)) prepends `solhint-config-` to any non-absolute, non-`solhint:` package name:

```javascript
const configGetter = (path) => {
    if (isAbsolute(path)) {
        return require(path);
    }
    return path.startsWith('solhint:')
        ? getSolhintCoreConfig(path)
        : require(`solhint-config-${path}`); // ← Breaks scoped packages!
};
```

This means it tries to load `solhint-config-@layerzerolabs/solhint-configuration`, which doesn't exist.

### Our Solution

By using `require()` in a local `solhint.config.js` with the explicit `--config` flag, we:

1. **Bypass package name transformation** - Node's `require()` properly resolves workspace packages
2. **Maintain centralized config** - All rules are defined in one place
3. **Enable easy overrides** - Projects can spread and customize the base config
4. **Work within Solhint's constraints** - Use the `--config` flag to explicitly specify the config file

### Why the `--config` Flag is Required

You might wonder if we can simplify this by using automatic config discovery (without `--config`). Unfortunately, we cannot due to Solhint's file resolution behavior:

**Solhint's Config Discovery:**

- Solhint automatically looks for `.solhint.json`, `.solhintrc`, or `solhint.config.js`
- When found, it uses cosmiconfig's `extends` resolution
- As explained above, `extends` with scoped packages (`@layerzerolabs/...`) fails due to the `solhint-config-` prefix issue

**Why We Use `--config`:**

- The `--config` flag tells Solhint to use a specific file
- Our `solhint.config.js` uses Node's `require()` instead of Solhint's `extends` mechanism
- This bypasses the package name transformation and properly resolves workspace dependencies
- It's the only way to use a shared configuration with scoped package names in the current version of Solhint

**In summary:** We use `--config solhint.config.js` + `require()` as a workaround for Solhint's limitation with scoped npm packages.

## Benefits

✅ **Configuration Consistency** - All Solidity projects use the same base rules, eliminating configuration drift across packages

✅ **Easy Customization** - Projects can override specific rules while maintaining the base configuration

✅ **Centralized Maintenance** - Updates to linting rules are made once in this package and automatically available to all projects

✅ **Monorepo-Friendly** - Works seamlessly with pnpm workspace dependencies

## Example Project Structure

```
packages/your-project/
├── contracts/
│   └── YourContract.sol
├── solhint.config.js       # Loads shared config
└── package.json            # Includes lint script with --config flag
```
