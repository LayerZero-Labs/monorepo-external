# @layerzerolabs/build-utils-rust

Build utilities for Rust/Cargo packages in the LayerZero monorepo.

These helpers bridge the gap between the npm/pnpm package graph and Cargo's
build model, so Rust-based VM packages (Solana, Stellar, …) can be compiled
using their normal monorepo dependencies. Today the package exposes a single
command — `resolve` — with more to follow as the Rust build story grows.

## Installation

Add it as a dev dependency of the Rust package you want to build:

```jsonc
// package.json
"devDependencies": {
    "@layerzerolabs/build-utils-rust": "workspace:*"
}
```

## Commands

### `resolve`

Resolves all `@layerzerolabs` Cargo crates reachable through `node_modules`
(direct and transitive) into a flat `dependencies/` directory next to your
package, rewriting the `path = "…"` deps inside each copied `Cargo.toml` so the
vendored crates resolve each other locally.

The point is a self-contained package: instead of Cargo path deps reaching out
through `node_modules` (pnpm symlinks that point outside the package), every
dependency lives under the package root. This lets a build container mount only
the package — no monorepo, no registry publish, no git deps.

```bash
# From the Rust package root (auto-discovers layout)
build-utils-rust resolve

# Point at a specific package root / crate explicitly
build-utils-rust resolve --cwd ./path/to/package --cargo-dir ./contracts/my-crate
```

| Option               | Description                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `--cwd <path>`       | pnpm package root (where `node_modules/` lives). Defaults to the current dir.                |
| `--cargo-dir <path>` | Cargo crate directory to write `dependencies/` into. Defaults to the package root (`--cwd`). |
| `--log-level <lvl>`  | `trace` \| `debug` \| `info` \| `warn` \| `error`. Defaults to `info`.                       |

#### Where `dependencies/` is written

`dependencies/` is created at the resolved Cargo root — `--cargo-dir` if given,
otherwise the package root (`--cwd`). There's no VM-specific convention (no
hardcoded `programs/`, no `Anchor.toml`); it works for whatever layout the root
`Cargo.toml` describes:

- **Workspace root** (`[workspace]` at the package root) — one shared
  `dependencies/` at the root, referenced by members via relative paths (Solana
  `programs/*`, Stellar workspaces).
- **Single crate** (bare `[package]`) — `dependencies/` sits next to that
  crate's `Cargo.toml` (Solana library crates, a standalone Stellar crate).

#### What gets vendored (and what doesn't)

- **Files:** only `.rs`, `.toml`, and `.json` are copied. Prebuilt or non-source
  assets a build might read (`.wasm`, `.bin`, `.proto`, `.md`, …) are **not**
  vendored. If a crate's build genuinely needs one, add its extension to
  `COPY_EXTENSIONS` in `src/resolve/exclude.ts`.
- **Path deps:** rewritten by parsing the manifest (via `smol-toml`), so every TOML
  form is handled — inline tables (`dep = { path = "…" }`), the table-header form
  (`[dependencies.dep]` + `path = "…"`), `[dev-/build-dependencies]`,
  `[target.'cfg(…)'.dependencies]`, and `[workspace.dependencies]`. A rewritten manifest
  is re-serialized (comments/formatting are not preserved), which is invisible because
  `dependencies/` is regenerated every build; unchanged manifests are left untouched.
- **Scope:** every `@layerzerolabs` Cargo crate reachable through `node_modules`
  is vendored. That set is already pruned by pnpm to your package's declared deps,
  and a workspace dependency is copied **whole** (all members) to keep
  `workspace = true` inheritance intact — so some unused member crates may be copied.

#### Workspace dependencies

When a resolved dependency is itself a Cargo workspace (e.g.
`@layerzerolabs/protocol-stellar-v2`, whose member crates use
`version.workspace = true` / `dep = { workspace = true }`), it is copied **whole**
into `dependencies/<pkg>/` with its `[workspace]` root manifest preserved. That
keeps the vendored member crates' workspace inheritance intact, and lets a
consumer path-dep into a sub-crate any number of levels deep, e.g.
`dependencies/protocol-stellar-v2/endpoint-v2` or
`dependencies/oft-core-stellar-contracts`.

#### Consuming the vendored crates

`resolve` only **fills** `dependencies/` — it does **not** edit the consuming
package's own `Cargo.toml`. Point your package's path deps at `dependencies/…`
directly (the same way the Solana packages do):

```toml
# package Cargo.toml
[dependencies]
utils    = { path = "dependencies/common-utils-stellar-contracts" }
oft-core = { path = "dependencies/oft-core-stellar-contracts" }
endpoint-v2 = { path = "dependencies/protocol-stellar-v2/endpoint-v2", features = ["library"] }
```

Typically wired into a package's `build` script ahead of the Cargo build so
dependencies are resolved fresh each time.

## Development

```bash
pnpm build   # bundle with tsup
pnpm test    # run the vitest suite
pnpm lint    # eslint
```
