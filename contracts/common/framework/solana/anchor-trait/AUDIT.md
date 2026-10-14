# Anchor Trait — Audit Scope

A procedural macro framework that introduces **instruction traits** to Anchor Solana programs — compile-time enforceable instruction interfaces with optional default implementations.

For architecture details, see the [README](./README.md).

---

## Files in Scope

### Core Library (`src/`)

| File            | Description                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`        | Public API, `InstructionSet` trait, `InstructionSpec`, `declare_instructions!` macro                                 |
| `overrides.rs`  | Override collection — scans module for annotated handlers, validates context types, relocates into wrapper modules   |
| `generation.rs` | Instruction code generation — resolves dispatch targets (override vs default), emits entrypoints and context structs |
| `assembly.rs`   | Final assembly — combines prelude, overrides, defaults, extend macro, and `#[program]` module into output            |

### Crate Manifest

| File         | Description                                                          |
| ------------ | -------------------------------------------------------------------- |
| `Cargo.toml` | Package metadata, feature flags, dependency set, and release profile |

---

## Out of Scope

| Path                  | Reason                                    |
| --------------------- | ----------------------------------------- |
| `examples/`           | Example program demonstrating macro usage |
| `tests/`              | Test harness (snapshot tests via `insta`) |
| `Anchor.toml`         | Anchor framework configuration            |
| `AUDIT.md`            | This file                                 |
| `Cargo.lock`          | Dependency lock file                      |
| `package.json`        | NPM package configuration                 |
| `README.md`           | Documentation                             |
| `rust-toolchain.toml` | Toolchain pinning                         |
| `rustfmt.toml`        | Formatting configuration                  |
| `turbo.json`          | Turborepo configuration                   |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
