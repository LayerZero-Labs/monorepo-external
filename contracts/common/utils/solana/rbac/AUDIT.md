# RBAC — Audit Scope

A Role-Based Access Control framework for Anchor Solana programs. PDA-based role membership, 2-step default admin transfer, and proc-macro-driven instruction generation. Mirrors OpenZeppelin `AccessControl` semantics.

For architecture details, see the [README](./README.md).

---

## Files in Scope

### Main Crate (`src/`)

| File        | Description                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------- |
| `lib.rs`    | Public module exports; re-exports the `rbac-macros` proc-macros                                    |
| `traits.rs` | `RoleType` and `DefaultAdmin` trait definitions — role hierarchy, PDA seed derivation              |
| `types.rs`  | Parameter structs: `GrantRoleParams`, `RevokeRoleParams`, `RenounceRoleParams`, `DefaultAdminInfo` |
| `errors.rs` | `RbacError` enum — 8 error codes for authorization and validation failures                         |
| `events.rs` | Event structs: `RoleGranted`, `RoleRevoked`, `DefaultAdminTransferStarted`                         |

### Macros Crate (`macros/src/`)

| File                                            | Description                                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                                        | Exports 7 proc-macros: `#[rbac]`, `#[rbac_instruction]`, `#[init_default_admin]`, `#[only_role]`, `#[derive(RoleType)]`, `#[derive(DefaultAdmin)]`, `setup_default_admin!` |
| `rbac.rs`                                       | `#[rbac]` attribute macro — generates 6 RBAC instructions for a `#[program]` module                                                                                        |
| `state_types.rs`                                | `RoleMember` struct generator + `#[derive(DefaultAdmin)]` derive macro                                                                                                     |
| `role_type.rs`                                  | `#[derive(RoleType)]` — validates enum shape, emits trait impl                                                                                                             |
| `only_role.rs`                                  | `#[only_role]` — injects role membership PDA constraint into accounts struct                                                                                               |
| `init_default_admin.rs`                         | `#[init_default_admin]` — injects admin role member PDA init into accounts struct                                                                                          |
| `setup_default_admin.rs`                        | `setup_default_admin!` — writes the initial admin state and the first `RoleMember` (state, role, account, bump)                                                            |
| `utils.rs`                                      | Shared utilities: `ExprArg`, field validation helpers                                                                                                                      |
| `instructions/mod.rs`                           | Instruction set declaration (6 RBAC instructions)                                                                                                                          |
| `instructions/grant_role.rs`                    | `grant_role` — creates `RoleMember` PDA, rejects `DefaultAdmin` role                                                                                                       |
| `instructions/revoke_role.rs`                   | `revoke_role` — closes `RoleMember` PDA, requires role admin authority                                                                                                     |
| `instructions/renounce_role.rs`                 | `renounce_role` — self-closes own `RoleMember` PDA                                                                                                                         |
| `instructions/begin_default_admin_transfer.rs`  | 2-step admin transfer start — sets pending admin, emits event                                                                                                              |
| `instructions/accept_default_admin_transfer.rs` | 2-step admin transfer completion — atomically swaps admin PDAs                                                                                                             |
| `instructions/get_default_admin.rs`             | View instruction — returns current and pending admin info                                                                                                                  |

### Crate Manifests

| File                | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `Cargo.toml`        | Main crate package metadata, feature flags, dependency set, and release profile |
| `macros/Cargo.toml` | Procedural macro crate metadata and dependency set                              |

---

## Out of Scope

| Path                  | Reason                                           |
| --------------------- | ------------------------------------------------ |
| `macros/examples/`    | Example program demonstrating RBAC usage         |
| `tests/`              | Compile-time macro validation tests (`trybuild`) |
| `Anchor.toml`         | Anchor framework configuration                   |
| `AUDIT.md`            | This file                                        |
| `Cargo.lock`          | Dependency lock file                             |
| `package.json`        | NPM package configuration                        |
| `README.md`           | Documentation                                    |
| `rust-toolchain.toml` | Toolchain pinning                                |
| `rustfmt.toml`        | Formatting configuration                         |
| `turbo.json`          | Turborepo configuration                          |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
