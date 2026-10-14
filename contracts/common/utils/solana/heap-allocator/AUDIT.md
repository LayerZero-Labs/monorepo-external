# Heap Allocator — Audit Scope

`declare_allocator!`, a bump allocator for Anchor programs adapted from Mango v4. It grows upward from the heap start, so a program can use extra heap requested for the transaction, where the default allocator is limited to the first 32 KiB. Console OFT installs it through its default `custom-heap` feature.

---

## Files in Scope

| File             | Description                                                                      |
| ---------------- | -------------------------------------------------------------------------------- |
| `lib/src/lib.rs` | `declare_allocator!`: the `#[global_allocator]` bump allocator and `heap_used()` |
| `lib/Cargo.toml` | Crate metadata and dependencies                                                  |
| `Cargo.toml`     | Workspace members and release profile                                            |

---

## Out of Scope

| Path                       | Reason                                      |
| -------------------------- | ------------------------------------------- |
| `example/`                 | `demo` program exercising the allocator     |
| `tests/`                   | TypeScript tests against the `demo` program |
| `Anchor.toml`              | Anchor framework configuration              |
| `AUDIT.md`                 | This file                                   |
| `Cargo.lock`               | Dependency lock file                        |
| `LICENSE`                  | License                                     |
| `package.json`             | NPM package configuration                   |
| `rust-toolchain.toml`      | Toolchain pinning                           |
| `rustfmt.toml`             | Formatting configuration                    |
| `tsconfig.json`            | TypeScript configuration                    |
| `turbo-snapshot.lock.json` | Build snapshot lock                         |
| `turbo.json`               | Turborepo configuration                     |
| `vitest.config.ts`         | Test runner configuration                   |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
