# Pubkey Policy — Audit Scope

A permissionless pubkey-policy oracle for Solana. Anyone creates a policy for a mint and names its DefaultAdmin; the policy keeps one blacklist/whitelist record per subject and an `Open`, `Blacklist` or `Whitelist` mode that decides which flag counts. A policy binds nothing on its own: consumers (Console OFT, the token-app TokenManager gate and transfer hook) select the one they accept and read it through `pubkey-policy-interface`.

Roles come from the separately scoped [rbac](../rbac/AUDIT.md) crate and the build-time program ID from [program-id](../program-id/AUDIT.md).

---

## Files in Scope

### Program: `pubkey_policy` (`programs/pubkey_policy/src/`)

| File                                 | Description                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                             | Program ID and instruction surface: `init_pubkey_policy`, `set_blacklisted`, `set_whitelisted`, `set_mode`, `get_version`, plus the RBAC instructions |
| `types.rs`                           | `RoleType`: DefaultAdmin, Blacklister, Whitelister                                                                                                    |
| `errors.rs`                          | `PubkeyPolicyError` (8005+), continuing the shared `PolicyError` range                                                                                |
| `events.rs`                          | `PubkeyPolicyInitialized`, `MembershipChanged`, `ModeChanged`                                                                                         |
| `instructions/init_pubkey_policy.rs` | Permissionless: the initializer creates its policy for a mint and names its DefaultAdmin                                                              |
| `instructions/membership.rs`         | Shared single-flag record update; rejects writes that change nothing                                                                                  |
| `instructions/set_blacklisted.rs`    | Blacklister sets one subject's blacklist flag                                                                                                         |
| `instructions/set_whitelisted.rs`    | Whitelister sets one subject's whitelist flag                                                                                                         |
| `instructions/set_mode.rs`           | DefaultAdmin changes the policy mode; memberships are kept                                                                                            |
| `instructions/get_version.rs`        | View returning the program's build versions                                                                                                           |
| `instructions/mod.rs`                | Module wiring                                                                                                                                         |

### Interface crate: `pubkey-policy-interface` (`interface/src/`)

| File               | Description                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| `lib.rs`           | Program ID and module exports                                                                                   |
| `state.rs`         | `PubkeyPolicy`, `PubkeyPolicyMode`, and the per-subject `SubjectRecord` with its `Membership` flags             |
| `seeds.rs`         | Policy and subject-record seeds and canonical addresses, including under another owning program                 |
| `pubkey_policy.rs` | Consumer-side reads: validates records against the policy's owning program and decides whether a key is blocked |
| `error.rs`         | `PolicyError` (8000-8004) and `declare_policy_errors!`, which consumers use to share those codes                |
| `version.rs`       | `ProgramVersion` returned by `get_version`                                                                      |

### Crate Manifests

| File                                | Description                                                 |
| ----------------------------------- | ----------------------------------------------------------- |
| `Cargo.toml`                        | Workspace members, dependency pins and release profile      |
| `interface/Cargo.toml`              | Interface crate dependencies and features                   |
| `programs/pubkey_policy/Cargo.toml` | `pubkey_policy` package metadata, features and dependencies |

---

## Out of Scope

| Path                       | Reason                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `dependencies/`            | Local copies of dependency packages covered by separate audit scopes (`anchor-trait`, `program-id`, `rbac`) |
| `tests/`                   | Mollusk integration suite                                                                                   |
| `scripts/`                 | Build and test scripts                                                                                      |
| `Anchor.toml`              | Anchor framework configuration                                                                              |
| `AUDIT.md`                 | This file                                                                                                   |
| `Cargo.lock`               | Dependency lock file                                                                                        |
| `package.json`             | NPM package configuration                                                                                   |
| `rust-toolchain.toml`      | Toolchain pinning                                                                                           |
| `rustfmt.toml`             | Formatting configuration                                                                                    |
| `turbo-snapshot.lock.json` | Build snapshot lock                                                                                         |
| `turbo.json`               | Turborepo configuration                                                                                     |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
