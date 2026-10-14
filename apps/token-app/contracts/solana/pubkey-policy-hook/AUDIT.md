# Pubkey Policy Hook (Solana) — Audit Scope

One production program: `pubkey_policy_hook`, an optional Token-2022 transfer hook that checks a bound pubkey policy on every transfer.

The policies it reads belong to the separately scoped [pubkey-policy](../../../../../contracts/common/utils/solana/pubkey-policy/AUDIT.md) program, and build-time program IDs come from [program-id](../../../../../contracts/common/utils/solana/program-id/AUDIT.md). It is used alongside the separately scoped [token manager](../token-manager/AUDIT.md), whose integration suite covers the hook's cross-program scenarios.

For architecture details, see the [README](./README.md).

---

## Files in Scope

### Program: `pubkey_policy_hook` (`programs/pubkey_policy_hook/src/`)

| File                                 | Description                                                                                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                             | Program ID and the `init_transfer_hook` / SPL `Execute` surface                                                                                                      |
| `state.rs`                           | The canonical SPL extra-account-metas manifest, the hook's only state                                                                                                |
| `errors.rs`                          | `HookError` (9000+) after the shared `PolicyError` variants (8000-8004)                                                                                              |
| `events.rs`                          | `TransferHookInitialized`                                                                                                                                            |
| `instructions/init_transfer_hook.rs` | The mint's hook-update authority binds or re-binds a created policy into the manifest                                                                                |
| `instructions/transfer_hook.rs`      | Requires the `transferring` flag on both accounts, then checks source owner, destination owner and executing authority against the policy; Permanent Delegate exempt |
| `instructions/mod.rs`                | Module wiring                                                                                                                                                        |

### Crate Manifests

| File                                     | Description                                                      |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `Cargo.toml`                             | Workspace members, dependency pins and release profile           |
| `programs/pubkey_policy_hook/Cargo.toml` | `pubkey_policy_hook` package metadata, features and dependencies |

---

## Out of Scope

| Path                       | Reason                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `dependencies/`            | Local copies of dependency packages covered by separate audit scopes (`anchor-trait`, `program-id`, `pubkey-policy`, `rbac`) |
| `programs/*/tests/`        | Program-local Rust tests                                                                                                     |
| `scripts/`                 | Build and build-output check scripts                                                                                         |
| `Anchor.toml`              | Anchor framework configuration                                                                                               |
| `AUDIT.md`                 | This file                                                                                                                    |
| `Cargo.lock`               | Dependency lock file                                                                                                         |
| `turbo-snapshot.lock.json` | Build snapshot lock                                                                                                          |
| `package.json`             | NPM package configuration                                                                                                    |
| `README.md`                | Documentation                                                                                                                |
| `rust-toolchain.toml`      | Toolchain pinning                                                                                                            |
| `rustfmt.toml`             | Formatting configuration                                                                                                     |
| `turbo.json`               | Turborepo configuration                                                                                                      |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
