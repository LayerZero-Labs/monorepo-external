# Program ID — Audit Scope

`declare_program_id!`, which declares a Solana program's ID from a build-time environment variable with a literal fallback, and registers that variable with cargo so a changed value forces a rebuild. Used by the deployable Console OFT, token-app and pubkey-policy programs.

For the problem it solves and how it works, see the [README](./README.md).

---

## Files in Scope

| File             | Description                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `lib/src/lib.rs` | `declare_program_id!`: `option_env!` marker plus `declare_id!` from `program_id_from_env!` |
| `lib/Cargo.toml` | Crate metadata and dependencies                                                            |
| `Cargo.toml`     | Workspace members and release profile                                                      |

---

## Out of Scope

| Path                  | Reason                                        |
| --------------------- | --------------------------------------------- |
| `tests/`              | Probe program and rebuild / IDL-shape scripts |
| `Anchor.toml`         | Anchor framework configuration                |
| `AUDIT.md`            | This file                                     |
| `Cargo.lock`          | Dependency lock file                          |
| `package.json`        | NPM package configuration                     |
| `README.md`           | Documentation                                 |
| `rust-toolchain.toml` | Toolchain pinning                             |
| `rustfmt.toml`        | Formatting configuration                      |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
