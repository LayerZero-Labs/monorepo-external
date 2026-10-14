# OFT — Audit Scope

The OFT (Omnichain Fungible Token) standard for LayerZero V2 on Solana. This is an interface crate, not a deployable program. It defines the `IOFT` instruction surface (`token`, `shared_decimals`, `quote_oft`, `quote_send`, `send`), parameter/return types, events, and the `OftInfo` TLV entry that identifies the OFT family and routes to a project-specific `OAppInfo` entry.

All five OFT instructions are spec-only. The macro emits interface-compatible instruction declarations and compile-time override checks, but a concrete OFT program must provide the runtime behavior.

For architecture and EVM-parity details, see [`solana-evm-parity-analysis.md`](./solana-evm-parity-analysis.md).

---

## Files in Scope

### Main Crate (`src/`)

| File          | Description                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.rs`      | Public module exports, `OFT_SEED` PDA seed constant, re-export of procedural macros from `oft_macros`                                                                           |
| `oft_info.rs` | `OftInfo` TLV entry: schema version and the `project_discriminator` route field                                                                                                 |
| `types.rs`    | `OftType` runtime custody enum and IOFT parameter/return structs: `SendParams`, `QuoteSendParams`, `QuoteOFTParams`, `QuoteOFTResult`, `OFTReceipt`, `OFTLimit`, `OFTFeeDetail` |
| `events.rs`   | Event structs: `OFTSent`, `OFTReceived`                                                                                                                                         |

### Macros Crate (`macros/src/`)

| File                              | Description                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `lib.rs`                          | Exports 2 proc-macros: `#[oft]` (attribute), `#[oft_instruction]` (no-op override marker detected by `#[oft]`)   |
| `oft.rs`                          | `#[oft]` attribute macro — collects overrides, generates IOFT instructions, applies `#[oapp(state = …)]` wrapper |
| `instructions/mod.rs`             | `OftInstructionSet` declaration (5 IOFT instructions) and `CodegenContext`                                       |
| `instructions/token.rs`           | `token` — spec only, view, returns mint `Pubkey` (no default, must override)                                     |
| `instructions/shared_decimals.rs` | `shared_decimals` — spec only, view, returns `u8` (no default, must override)                                    |
| `instructions/quote_oft.rs`       | `quote_oft` — spec only, view, returns `QuoteOFTResult` (no default, must override)                              |
| `instructions/quote_send.rs`      | `quote_send` — spec only, view, returns `MessagingFee` (no default, must override)                               |
| `instructions/send.rs`            | `send` — spec only, returns `(MessagingReceipt, OFTReceipt)` (no default, must override)                         |

### Crate Manifests

| File                | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `Cargo.toml`        | Main crate package metadata, feature flags, dependency set, and release profile |
| `macros/Cargo.toml` | Procedural macro crate metadata and dependency set                              |

---

## Audit Notes

- This package should be reviewed as reusable interface and code-generation infrastructure for concrete Solana OFT programs.
- Runtime token custody, fee, pause, rate-limit, transfer-hook, and endpoint CPI behavior belong to concrete implementations such as `console_oft`, not this crate.
- The copied dependency packages under `dependencies/` are not part of this package's new audit scope; they are covered by separate package audit scopes.

---

## Out of Scope

| Path                            | Reason                                                               |
| ------------------------------- | -------------------------------------------------------------------- |
| `dependencies/`                 | Local copies of dependency packages covered by separate audit scopes |
| `solana-evm-parity-analysis.md` | Design / EVM-parity notes (non-executable)                           |
| `Anchor.toml`                   | Anchor framework configuration                                       |
| `AUDIT.md`                      | This file                                                            |
| `Cargo.lock`                    | Dependency lock file                                                 |
| `package.json`                  | NPM package configuration                                            |
| `rust-toolchain.toml`           | Toolchain pinning                                                    |
| `rustfmt.toml`                  | Formatting configuration                                             |
| `turbo.json`                    | Turborepo configuration                                              |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
