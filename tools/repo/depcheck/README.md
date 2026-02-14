# @layerzerolabs/depcheck

Dependency management and analysis tools for pnpm monorepos.

## Commands

### `visualize` - Dependency Graph Visualization

Generate interactive HTML dependency graph.

```bash
pnpm --filter @layerzerolabs/depcheck run depcheck visualize --from <package> --depth <n>
```

**Example:**

```bash
# Visualize vm-tooling dependencies, 4 levels deep
pnpm --filter @layerzerolabs/depcheck run depcheck visualize \
  --from @layerzerolabs/vm-tooling \
  --depth 4
```

**Options:**

| Option                            | Description                                 | Example                                      |
| --------------------------------- | ------------------------------------------- | -------------------------------------------- |
| `--from <package>`                | Start from a package (forward dependencies) | `--from @layerzerolabs/vm-tooling`           |
| `--to <package>`                  | End at a package (reverse dependencies)     | `--to @layerzerolabs/common-utils`           |
| `--depth <number>`                | Depth to traverse (default: 1)              | `--depth 4`                                  |
| `--regex <pattern>`               | Filter packages by regex                    | `--regex "^@layerzerolabs/.*"`               |
| `--only <name>`                   | Check only specific package(s)              | `--only @layerzerolabs/vm-tooling`           |
| `--ignore <pattern>`              | Ignore packages                             | `--ignore test-packages`                     |
| `--only-internal`                 | Only include workspace packages             | `--only-internal`                            |
| `--update-deps`                   | Update dependencies before visualization    | `--update-deps`                              |
| `--ignore-patterns <patterns...>` | Glob patterns to ignore                     | `--ignore-patterns "docker/**" "scripts/**"` |

Output: `graph.html` (interactive visualization)

---

### `deps` - Check & Fix Dependencies

Detect missing and unused dependencies, auto-fix `package.json` files.

```bash
pnpm --filter @layerzerolabs/depcheck run depcheck deps [options]
```

**Example:**

```bash
# Check and fix all packages
pnpm --filter @layerzerolabs/depcheck run depcheck deps --write

# Check specific package only
pnpm --filter @layerzerolabs/depcheck run depcheck deps \
  --only @layerzerolabs/vm-tooling
```

**Options:**

| Option                            | Description                              | Example                            |
| --------------------------------- | ---------------------------------------- | ---------------------------------- |
| `-w, --write`                     | Write changes to package.json files      | `--write`                          |
| `--catalogize`                    | Run catalogize after writing             | `--catalogize`                     |
| `--to-dev <pattern>`              | Move matching deps to devDependencies    | `--to-dev "^@types/"`              |
| `--only <name>`                   | Check only specific package(s)           | `--only @layerzerolabs/vm-tooling` |
| `--ignore <pattern>`              | Ignore packages                          | `--ignore test-packages`           |
| `--no-regex`                      | Disable regex pattern matching           | `--no-regex`                       |
| `--no-sort`                       | Skip sorting dependencies                | `--no-sort`                        |
| `--no-dups`                       | Check for duplicates in deps and devDeps | `--no-dups`                        |
| `--ignore-patterns <patterns...>` | Glob patterns to ignore in analysis      | `--ignore-patterns "docker/**"`    |

---

### `validate` - Validate Dependencies (CI)

Validate dependencies and catalog. Throws errors if issues found (use in CI).

```bash
pnpm --filter @layerzerolabs/depcheck run depcheck validate [options]
```

**Example:**

```bash
# Validate missing dependencies
pnpm --filter @layerzerolabs/depcheck run depcheck validate --missing-dependencies

# Validate catalog is up to date
pnpm --filter @layerzerolabs/depcheck run depcheck validate --catalog

# Check specific package
pnpm --filter @layerzerolabs/depcheck run depcheck validate \
  --missing-dependencies \
  --only @layerzerolabs/vm-tooling
```

**Options:**

| Option                            | Description                           | Example                            |
| --------------------------------- | ------------------------------------- | ---------------------------------- |
| `--missing-dependencies`          | Check for missing/unused dependencies | `--missing-dependencies`           |
| `--catalog`                       | Validate catalog is up to date        | `--catalog`                        |
| `--only <name>`                   | Check only specific package(s)        | `--only @layerzerolabs/vm-tooling` |
| `--no-dups`                       | Check for duplicates                  | `--no-dups`                        |
| `--ignore-patterns <patterns...>` | Glob patterns to ignore               | `--ignore-patterns "docker/**"`    |

---

### `catalogize` - Move Versions to Catalog

Move dependency versions to pnpm workspace catalog.

```bash
pnpm --filter @layerzerolabs/depcheck run depcheck catalogize [options]
```

**Example:**

```bash
# Catalogize all packages
pnpm --filter @layerzerolabs/depcheck run depcheck catalogize

# Catalogize specific dependencies only
pnpm --filter @layerzerolabs/depcheck run depcheck catalogize \
  --dependencies "react,typescript"
```

**Options:**

| Option                  | Description                    | Example                             |
| ----------------------- | ------------------------------ | ----------------------------------- |
| `--only <name>`         | Check only specific package(s) | `--only @layerzerolabs/vm-tooling`  |
| `--dependencies <deps>` | Only catalogize specific deps  | `--dependencies "react,typescript"` |

---

### `export` - Export to External Repo

Export packages to external GitHub repository.

```bash
pnpm --filter @layerzerolabs/depcheck run depcheck export [package] [options]
```

**Example:**

```bash
# Export specific package
pnpm --filter @layerzerolabs/depcheck run depcheck export \
  @layerzerolabs/vm-tooling \
  --remote https://github.com/org/repo \
  --branch main \
  --message "Update packages" \
  --author "Your Name" \
  --email "your@email.com"

# Export all public packages
pnpm --filter @layerzerolabs/depcheck run depcheck export \
  --all-public \
  --remote https://github.com/org/repo
```

**Options:**

| Option                | Description                | Example                           |
| --------------------- | -------------------------- | --------------------------------- |
| `-r, --remote <url>`  | Remote URL                 | `--remote https://github.com/...` |
| `-b, --branch <name>` | Branch name                | `--branch main`                   |
| `-m, --message <msg>` | Commit message             | `--message "Update"`              |
| `-a, --author <name>` | Author name                | `--author "Your Name"`            |
| `-e, --email <email>` | Author email               | `--email "your@email.com"`        |
| `--all-public`        | Export all public packages | `--all-public`                    |
| `--exclude <list>`    | Exclude specific packages  | `--exclude "pkg1,pkg2"`           |

Requires: `GITHUB_TOKEN` environment variable

---

### `find` - Find Config Files

Find and visualize config files across the monorepo.

```bash
pnpm --filter @layerzerolabs/depcheck run depcheck find [options]
```

**Example:**

```bash
# Find all config files
pnpm --filter @layerzerolabs/depcheck run depcheck find

# Find configs with specific keywords
pnpm --filter @layerzerolabs/depcheck run depcheck find \
  --keywords "mainnet,testnet"
```

**Options:**

| Option                    | Description                           | Example                           |
| ------------------------- | ------------------------------------- | --------------------------------- |
| `--common-configs <list>` | Shared config names (comma-separated) | `--common-configs "index,config"` |
| `--keywords <keywords>`   | Keywords to search for                | `--keywords "mainnet,testnet"`    |

---

### `analyze-imports` - Import Analysis

Analyze which symbols are imported from a specific package.

```bash
pnpm --filter @layerzerolabs/depcheck run depcheck analyze-imports <package> [options]
```

**Example:**

```bash
# Analyze what's imported from common-utils
pnpm --filter @layerzerolabs/depcheck run depcheck analyze-imports \
  @layerzerolabs/common-utils
```

**Options:**

| Option                            | Description                    | Example                            |
| --------------------------------- | ------------------------------ | ---------------------------------- |
| `--update-deps`                   | Update dependencies first      | `--update-deps`                    |
| `--only <name>`                   | Check only specific package(s) | `--only @layerzerolabs/vm-tooling` |
| `--ignore <pattern>`              | Ignore packages                | `--ignore test-packages`           |
| `--no-regex`                      | Disable regex pattern matching | `--no-regex`                       |
| `--ignore-patterns <patterns...>` | Glob patterns to ignore        | `--ignore-patterns "docker/**"`    |

---

## Common Workflows

```bash
# 1. Check dependencies before commit
pnpm --filter @layerzerolabs/depcheck run depcheck deps

# 2. Fix all dependency issues
pnpm --filter @layerzerolabs/depcheck run depcheck deps --write

# 3. Visualize what depends on a package
pnpm --filter @layerzerolabs/depcheck run depcheck visualize \
  --to @layerzerolabs/common-utils \
  --depth 2

# 4. CI validation
pnpm --filter @layerzerolabs/depcheck run depcheck validate \
  --missing-dependencies \
  --catalog

# 5. Move deps to catalog
pnpm --filter @layerzerolabs/depcheck run depcheck catalogize
```
