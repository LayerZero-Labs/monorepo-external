# Console OFT App - Audit Scope

The Console OFT app for LayerZero V2 on Solana contains one production program in this audit scope:

- `console_oft`: a concrete OFT implementation built on separately scoped `oapp`, `oft`, and `rbac` interfaces, with the extended OFT interfaces implemented directly in the program.

`console_oft` overrides the Solana OFT and `lz_receive*` OApp interfaces. It implements 22 extended-interface instructions across `IFeeConfig`, `IFeeHandler`, `IPauseByID`, and `IRateLimiter`, adds credit redirect and pubkey-policy configuration, and exposes project-specific metadata and transfer-hook cache instructions. The OApp macro also supplies RBAC-gated `clear`, `skip`, `burn`, and `nilify` messaging-channel wrappers.

For architecture details, see the [README](./README.md), [`docs/console-oft-info.md`](./docs/console-oft-info.md), [`oft-info.md`](../../../../oft-app/contracts/solana/oft/docs/oft-info.md), [`docs/solana-evm-parity-analysis.md`](./docs/solana-evm-parity-analysis.md) (extended-interface parity).

The crates and programs it links, CPIs into or reads are separately scoped:

- [oapp](../../../oapp-app/contracts/solana/AUDIT.md), [oft](../../../../oft-app/contracts/solana/oft/AUDIT.md), [rbac](../../../../../contracts/common/utils/solana/rbac/AUDIT.md) and [anchor-trait](../../../../../contracts/common/framework/solana/anchor-trait/AUDIT.md)
- [token-manager](../../../../token-app/contracts/solana/token-manager/AUDIT.md): `token-manager-interface` and the `token_manager` program
- [pubkey-policy-hook](../../../../token-app/contracts/solana/pubkey-policy-hook/AUDIT.md): the `pubkey_policy_hook` program
- [pubkey-policy](../../../../../contracts/common/utils/solana/pubkey-policy/AUDIT.md): `pubkey-policy-interface` and the `pubkey_policy` program
- [program-id](../../../../../contracts/common/utils/solana/program-id/AUDIT.md) and [heap-allocator](../../../../../contracts/common/utils/solana/heap-allocator/AUDIT.md)

---

## Files in Scope

### Program: `console_oft` (`programs/console_oft/src/`)

| File                  | Description                                                                                                                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`              | Program ID declaration and `#[oft::oft(state = OFTStore, role_type = RoleType)]` module declaring the OFT, extended, OApp, and app-specific instruction surface                                                                                         |
| `console_oft_info.rs` | `ConsoleOftInfo` TLV entry (sibling to `OAppBase` and `OftInfo`); schema / IDL version metadata for the Console OFT project leaf; `init_console_oft_info` writes the `OAppBase -> OftInfo -> ConsoleOftInfo` route                                      |
| `events.rs`           | Single `#[event]` catalog for the program (15 events across pause, fee, rate-limit, pubkey policy, token manager, credit redirect and the cached-program syncs); each event carries `oft_store` so indexers can attribute it to a specific OFT instance |
| `errors.rs`           | `OFTError` (13000+) for slippage, rate-limit, pause, fee, mint authority, transfer-hook, credit-redirect, pubkey-policy, ACL and permissioned-burn failures, declared after the shared `PolicyError` variants (8000-8004)                               |
| `seeds.rs`            | PDA seed-prefix constants for fee, pause, rate-limit, rate-limit exemption, and OFT escrow accounts                                                                                                                                                     |

**Codec (`programs/console_oft/src/codec/`)**

| File             | Description                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`         | Module declarations                                                                                                  |
| `msg.rs`         | OFT message wire codec: `[send_to][amount_sd][sender?][compose_msg?]`; `encode` plus field accessors                 |
| `compose_msg.rs` | Composed-message wire codec: `[nonce][src_eid][amount_ld][compose_from][compose_msg]`; `encode` plus field accessors |

**State (`programs/console_oft/src/state/`)**

| File            | Description                                                                                                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`        | `RoleType` (including messaging-channel manager/nilifier), `PauseConfig`, `FeeConfig`, and canonical 16-byte big-endian ID seed conversion                                                                                                           |
| `oft.rs`        | `OFTStore` PDA: immutable OFT settings, cached transfer-hook and ACL gating programs, embedded default admin, default pause/fee, fee deposit, rate-limit global flags, optional credit redirect config, selected pubkey policy and TokenManager root |
| `rate_limit.rs` | `RateLimit` and `RateLimitAddressExemption` PDAs, inflow/outflow/checkpoint logic, usage decay, default-vs-per-ID config resolution, EVM-parity helpers                                                                                              |

**Helpers (`programs/console_oft/src/helpers/`)**

| File                        | Description                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`                    | `MsgType` (`Send` / `SendAndCall`), `combine_options`, owned-account serialization helper, and module re-exports            |
| `token2022.rs`              | Reads the mint's transfer-hook program and PermissionedBurn state; builds SPL hook `Execute` instruction data               |
| `transfer_hook_accounts.rs` | Frames and validates one transfer-hook account group (program, manifest witness, extras) and yields the native CPI accounts |
| `transfer_hook_plan.rs`     | Resolves a hook's `ExtraAccountMetaList` into planned account metas, including for a recipient ATA that does not exist yet  |
| `receive_accounts.rs`       | Parses `lz_receive`'s remaining accounts into clear, gate, per-destination hook and compose groups                          |
| `pubkey_policy.rs`          | Binds the supplied pubkey policy accounts to `OFTStore`'s selection and mint; maps ACL-interface errors                     |
| `credit_redirect.rs`        | Matches the optional configured redirect escrow address                                                                     |

**OFT and OApp Instructions (`programs/console_oft/src/instructions/`)**

| File                            | Description                                                                                                                                                                                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`                        | Module re-exports for instruction handlers                                                                                                                                                                                                                        |
| `init_console_oft_info.rs`      | Allocates the program-level `OAppInfo` PDA and writes the `OAppBase -> OftInfo -> ConsoleOftInfo` TLV chain (single-use per program deployment)                                                                                                                   |
| `init_console_oft.rs`           | Initializes `OFTStore`, the escrow token account PDA, and default admin role; supports `BurnMint` / `LockUnlock`                                                                                                                                                  |
| `send.rs`                       | Debits sender through escrow, applies fee and outbound rate limit, validates transfer-hook groups, burns directly or through the accepted root's `permissioned_burn` with only the escrow's capped delegate signature, CPIs `endpoint_cpi::send`, emits `OFTSent` |
| `quote_send.rs`                 | Read-only endpoint fee quote returning `MessagingFee`                                                                                                                                                                                                             |
| `quote_oft.rs`                  | Read-only quote returning `QuoteOFTResult` (limits, fees, receipt)                                                                                                                                                                                                |
| `oft_store_view.rs`             | View handlers reading `OFTStore`, including token, decimals, fee/pause/rate-limit defaults, and cached transfer-hook program                                                                                                                                      |
| `lz_receive.rs`                 | Endpoint receive path: pubkey-policy screening, inline ACL thaw, credit-route selection, clear, inbound rate limit, mint/unlock through escrow, compose, and receive/redirect events                                                                              |
| `lz_receive_types_info.rs`      | V3 bootstrap: protocol version and the accounts the planner needs                                                                                                                                                                                                 |
| `lz_receive_types_v3.rs`        | Message-dependent planner writing the `lz_receive` plan through `oapp::lz_plan`; includes both credit-redirect outcomes, hook accounts, ACL accounts and compose accounts                                                                                         |
| `sync_transfer_hook_program.rs` | Permissionless cache refresh from the mint's Token-2022 `TransferHook` extension into `OFTStore.transfer_hook_program`                                                                                                                                            |
| `sync_acl_gating_program.rs`    | Permissionless cache refresh of the mint's Token ACL gating program into `OFTStore.acl_gating_program`; emits `AclGatingProgramSynced`                                                                                                                            |
| `set_token_manager.rs`          | `DefaultAdmin`-gated selection or clearing of the TokenManager root whose owning program PermissionedBurn sends invoke; emits `TokenManagerSet`                                                                                                                   |
| `set_credit_redirect_config.rs` | `DefaultAdmin`-gated atomic enable/update/disable of the redirect token account; rejects token accounts owned by `OFTStore` (the escrow included) and frozen accounts                                                                                             |
| `set_pubkey_policy.rs`          | `DefaultAdmin`-gated selection or clearing of the receive pubkey policy; stores the admin's choice, which need not match the gate's or hook's binding (they must admit whoever it allows)                                                                         |

**Fee Config Instructions (`programs/console_oft/src/instructions/fee_config/`)** - overrides `IFeeConfig`

| File                     | Description                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `mod.rs`                 | Module re-exports plus the `MAX_FEE_BASIS_POINTS = 10_000` denominator shared by all fee-config handlers                      |
| `fee_config_view.rs`     | View handlers: `get_fee`, `get_amount_before_fee`, `fee_bps`; resolves default plus per-EID `FeeConfig` PDA, applies BPS math |
| `set_default_fee_bps.rs` | `FeeConfigManager`-gated default fee update on `OFTStore`; emits `DefaultFeeBpsSet`                                           |
| `set_fee_bps.rs`         | `FeeConfigManager`-gated per-EID fee override create/update/close; emits `FeeBpsSet`                                          |

**Fee Handler Instructions (`programs/console_oft/src/instructions/fee_handler/`)** - overrides `IFeeHandler`

| File                 | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `mod.rs`             | Module re-exports                                                            |
| `set_fee_deposit.rs` | `DefaultAdmin`-gated fee deposit update on `OFTStore`; emits `FeeDepositSet` |

**Pause Instructions (`programs/console_oft/src/instructions/pause/`)** - overrides `IPauseByID`

| File                    | Description                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `mod.rs`                | Module re-exports                                                                                     |
| `pause_config_view.rs`  | View handlers: `is_paused`, `get_pause_config`; combines default state with per-EID `PauseConfig` PDA |
| `set_default_paused.rs` | `Pauser`/`Unpauser`-gated default pause update on `OFTStore`; emits `DefaultPauseSet`                 |
| `set_paused.rs`         | Role-gated per-EID pause override create/update/close; emits `PauseSet`                               |

**Rate Limiter Instructions (`programs/console_oft/src/instructions/rate_limiter/`)** - overrides `IRateLimiter`

| File                                  | Description                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `mod.rs`                              | Module re-exports                                                                                                        |
| `rate_limits.rs`                      | View handler for `rate_limits`; reads the requested `RateLimit` PDA and returns `None` for uninitialized per-ID accounts |
| `get_rate_limit_usages.rs`            | View handler for `get_rate_limit_usages`; resolves default/global/per-EID state and returns decayed usage                |
| `is_rate_limit_address_exempt.rs`     | Checks `RateLimitAddressExemption` PDA existence                                                                         |
| `set_rate_limit_global_config.rs`     | `RateLimiterManager`-gated update of `OFTStore.use_global_state` / `is_globally_disabled`                                |
| `set_rate_limit_config.rs`            | `RateLimiterManager`-gated default (`id=0`) or per-EID rate-limit config update                                          |
| `set_rate_limit_state.rs`             | `RateLimiterManager`-gated manual recovery write of default or per-EID `RateLimitState`                                  |
| `set_rate_limit_address_exemption.rs` | `RateLimiterManager`-gated exemption PDA create/close                                                                    |
| `checkpoint_rate_limit.rs`            | `RateLimiterManager`-gated usage decay and state checkpoint for default or per-EID limiter                               |

### Crate Manifests

| File                              | Description                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------- |
| `Cargo.toml`                      | Workspace members, resolver, and release profile for the Solana contracts package             |
| `programs/console_oft/Cargo.toml` | `console_oft` program package metadata, feature flags, dependency set, and lint configuration |

---

## Out of Scope

| Path                  | Reason                                                                                                                                                                                               |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies/`       | Local copies of dependency packages covered by separate audit scopes (`anchor-trait`, `heap-allocator`, `oapp`, `oft`, `program-id`, `pubkey-policy`, `rbac`, `token-manager`, `pubkey-policy-hook`) |
| `docs/`               | Design documentation (non-executable)                                                                                                                                                                |
| `sdk/`                | Generated TypeScript SDK                                                                                                                                                                             |
| `scripts/`            | SDK generation and local tooling scripts                                                                                                                                                             |
| `tests/`              | TypeScript integration suites and test-only programs                                                                                                                                                 |
| `programs/*/tests/`   | Rust integration/Mollusk tests                                                                                                                                                                       |
| `programs/*/build.rs` | Build scripts                                                                                                                                                                                        |
| `build/`              | Compiled IDL JSON output                                                                                                                                                                             |
| `Anchor.toml`         | Anchor framework configuration                                                                                                                                                                       |
| `AUDIT.md`            | This file                                                                                                                                                                                            |
| `Cargo.lock`          | Dependency lock file                                                                                                                                                                                 |
| `package.json`        | NPM package configuration                                                                                                                                                                            |
| `README.md`           | Documentation                                                                                                                                                                                        |
| `tsconfig.json`       | TypeScript configuration                                                                                                                                                                             |
| `vitest.config.ts`    | Vitest test runner configuration                                                                                                                                                                     |
| `rust-toolchain.toml` | Toolchain pinning                                                                                                                                                                                    |
| `rustfmt.toml`        | Formatting configuration                                                                                                                                                                             |
| `turbo.json`          | Turborepo configuration                                                                                                                                                                              |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
