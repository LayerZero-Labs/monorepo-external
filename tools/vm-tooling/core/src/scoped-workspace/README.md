# Scoped Workspace

`scoped-workspace` creates a temporary, repo-shaped filesystem for containerized package builds.
It gives Docker the package sources and pnpm layout needed for a build without mounting the full
monorepo.

The tool executor owns the created temp root and removes it after the Docker run completes.

## Build Layout

`createScopedWorkspace` returns three paths for the Docker runner:

- `scopedRoot`, mounted as `/workspace`.
- the current package root, bind-mounted at its repo-relative path under `/workspace`.
- the real pnpm virtual store, bind-mounted at `/workspace/node_modules/.pnpm`.

The current package is mounted from the host instead of copied, so package-local build outputs such
as `target`, `build`, and `src/generated` are written back to the real package.

## Creation Flow

1. `resolveWorkspaceDependencyGraph` finds the package that owns `cwd`.
2. It reads `pnpm-lock.yaml` importers and follows workspace `link:` dependencies.
3. `copyWorkspaceSources` copies source files for the workspace dependency closure into `scopedRoot`.
4. `copyRootNodeModulesSymlinks` copies the root `node_modules` symlinks referenced by that closure.

## Source Copy Rules

By default, dependency packages are copied with `DEFAULT_SOURCE_COPY_PATTERNS`, currently `['**/*']`.
The copy always also applies `DEFAULT_SOURCE_COPY_EXCLUDE_PATTERNS`, which skips generated outputs
and caches such as `.turbo`, `artifacts*`, `build`, `cache`, `out`, `target`, and `typechain-types`.

Symlinks are preserved as links. Files under package-local `node_modules` are not copied; dependency
contents come from the mounted root pnpm virtual store.

## Pruner Hook

A VM-specific pruner can inspect the computed dependency graph and return a glob-compatible copy
plan:

- `patterns` sets the global include/exclude list for dependency source copies.
- `packagePatterns` overrides the global list for specific workspace package paths.
- `diagnostics` are surfaced by the tool executor.

Use explicit glob patterns such as `src/**` for directory contents and `!tests/**` for exclusions.
If no pruner is configured, or if the selected pruner pattern list is empty, the copy falls back to
`DEFAULT_SOURCE_COPY_PATTERNS`.
