# OApp — Audit Scope

The OApp Standard Framework for LayerZero V2 on Solana. Provides a unified instruction interface, RBAC-protected admin operations, endpoint CPI helpers, V3 execution model types, and proc-macro-driven code generation.

For architecture details, see the [README](./README.md) and [docs/](./docs/).

---

## Files in Scope

### Main Crate (`src/`)

| File                     | Description                                                                                                                                   |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                 | Public API, PDA seed constants, `OAppState` trait, and `MessagingChannelRoles` contract                                                       |
| `common.rs`              | `ExecutionContextV1`, `AddressLocator`, `AccountMetaRef`                                                                                      |
| `endpoint_cpi.rs`        | CPI wrappers for registration/delegate, send/quote, receive/compose clearing, and `clear`/`skip`/`burn`/`nilify` messaging-channel operations |
| `oapp_info.rs`           | `OAppInfo` PDA, `OAppBase`, `IdlVersion`, `init_oapp_base!` macro, version constants                                                          |
| `lz_receive_types_v3.rs` | V3 receive plan types: `LzReceiveTypesV3Accounts`, `LzReceiveTypesV3Result`, `Instruction`; Endpoint `clear`/`send_compose` account helpers   |
| `lz_compose_types_v3.rs` | V3 compose plan types: `LzComposeTypesV3Accounts`, `LzComposeTypesV3Result`, `ComposeInstruction`; Endpoint `clear_compose` account helper    |
| `lz_plan.rs`             | Writes a V3 plan into a caller-created scratch account and returns its length                                                                 |
| `options.rs`             | Options combining logic (`combine_options`), Type 3 validation (`assert_type_3`)                                                              |
| `types.rs`               | Parameter/return structs for all instructions, including `ClearParams`, `SkipParams`, `BurnParams`, and `NilifyParams`                        |
| `errors.rs`              | `OAppError` enum — 5 error codes (offset 11000)                                                                                               |
| `events.rs`              | Event structs: `PeerSet`, `EnforcedOptionsSet`                                                                                                |
| `utils.rs`               | Account loading helper: `try_load_account` — deserializes from `UncheckedAccount`                                                             |

> **Note:** The following files originate from the previously audited [LayerZero-v2 OApp crate](https://github.com/LayerZero-Labs/LayerZero-v2/tree/main/packages/layerzero-v2/solana/anchor-latest/libs/oapp/src) and have been merged into this package: `common.rs`, `endpoint_cpi.rs`, `options.rs`, and the V2 predecessors of `lz_receive_types_v3.rs` / `lz_compose_types_v3.rs`. The remaining files (`oapp_info.rs`, `types.rs`, `errors.rs`, `events.rs`, `lz_plan.rs`) are new.

### Macros Crate (`macros/src/`)

| File                                                 | Description                                                                                              |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `lib.rs`                                             | Macro entry points: `#[oapp]`, `#[oapp_instruction]`, `#[composer]`, `#[composer_instruction]`           |
| `oapp.rs`                                            | `#[oapp]` macro — generates OApp instructions, applies RBAC, emits prelude                               |
| `composer.rs`                                        | `#[composer]` macro — generates composer program entrypoints                                             |
| `state_types.rs`                                     | State struct generators: `OAppPeer` and `EnforcedOptions`                                                |
| **OApp Instructions (`instructions/oapp/`)**         |                                                                                                          |
| `instructions/oapp/mod.rs`                           | `OAppInstructionSet` declaration (14 instructions)                                                       |
| `instructions/oapp/set_peer.rs`                      | `set_peer` — default impl, RBAC-protected, creates/updates `OAppPeer` PDA                                |
| `instructions/oapp/get_peer.rs`                      | `get_peer` — default impl, view, returns peer address                                                    |
| `instructions/oapp/init_enforced_options.rs`         | `init_enforced_options` — default impl, creates `EnforcedOptions` PDA                                    |
| `instructions/oapp/set_enforced_options.rs`          | `set_enforced_options` — default impl, updates with realloc                                              |
| `instructions/oapp/get_enforced_options.rs`          | `get_enforced_options` — default impl, view, returns encoded options                                     |
| `instructions/oapp/next_nonce.rs`                    | `next_nonce` — default impl, view; returns 0 (unordered delivery), OApps override it to enforce ordering |
| `instructions/oapp/is_compose_msg_sender.rs`         | `is_compose_msg_sender` — default impl, view, validates compose sender                                   |
| `instructions/oapp/lz_receive.rs`                    | `lz_receive` — spec only (no default, must override)                                                     |
| `instructions/oapp/lz_receive_types_info.rs`         | `lz_receive_types_info` — spec only (no default, must override)                                          |
| `instructions/oapp/lz_receive_types_v3.rs`           | `lz_receive_types_v3` — spec only (no default, must override)                                            |
| `instructions/oapp/clear.rs`                         | `clear` — manager-gated wrapper that injects the OApp receiver and CPIs Endpoint `clear`                 |
| `instructions/oapp/skip.rs`                          | `skip` — manager-gated wrapper that injects the OApp receiver and CPIs Endpoint `skip`                   |
| `instructions/oapp/burn.rs`                          | `burn` — manager-gated wrapper that injects the OApp receiver and CPIs Endpoint `burn`                   |
| `instructions/oapp/nilify.rs`                        | `nilify` — nilifier-gated wrapper that injects the OApp receiver and CPIs Endpoint `nilify`              |
| `instructions/oapp/accept_default_admin_transfer.rs` | RBAC override — syncs endpoint delegate on admin transfer                                                |
| **Composer Instructions (`instructions/composer/`)** |                                                                                                          |
| `instructions/composer/mod.rs`                       | `ComposerInstructionSet` declaration (3 instructions)                                                    |
| `instructions/composer/lz_compose.rs`                | `lz_compose` — spec only (no default, must override)                                                     |
| `instructions/composer/lz_compose_types_info.rs`     | `lz_compose_types_info` — spec only (no default, must override)                                          |
| `instructions/composer/lz_compose_types_v3.rs`       | `lz_compose_types_v3` — spec only (no default, must override)                                            |
| `instructions/mod.rs`                                | Module re-exports                                                                                        |

### Crate Manifests

| File                | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `Cargo.toml`        | Main crate package metadata, feature flags, dependency set, and release profile |
| `macros/Cargo.toml` | Procedural macro crate metadata, feature flags, and dependency set              |

---

## Out of Scope

| Path                  | Reason                                   |
| --------------------- | ---------------------------------------- |
| `docs/`               | Design documentation (non-executable)    |
| `macros/examples/`    | Example program demonstrating OApp usage |
| `macros/Cargo.lock`   | Macros dependency lock file              |
| `Anchor.toml`         | Anchor framework configuration           |
| `AUDIT.md`            | This file                                |
| `Cargo.lock`          | Dependency lock file                     |
| `package.json`        | NPM package configuration                |
| `README.md`           | Documentation                            |
| `rust-toolchain.toml` | Toolchain pinning                        |
| `rustfmt.toml`        | Formatting configuration                 |
| `turbo.json`          | Turborepo configuration                  |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
