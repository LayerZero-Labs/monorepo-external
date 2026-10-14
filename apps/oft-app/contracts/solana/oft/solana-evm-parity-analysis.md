# Solana vs EVM IOFT Interface Parity Analysis

> **Solana sources:**
>
> - Macro instructions: `apps/oft-app/contracts/solana/oft/macros/src/instructions/`
> - Type definitions: `apps/oft-app/contracts/solana/oft/src/types.rs`
> - Account structs: `apps/project-types/console-oft-app/contracts/solana/programs/console_oft/src/state/`
>
> **EVM sources (from `node_modules/@layerzerolabs/`):**
>
> - `oft-evm-contracts/contracts/interfaces/IOFT.sol`

---

## Overview

This document is the parity reference for the Solana IOFT macro interface against the EVM `IOFT` interface.

For extended interface parity (IFeeConfig, IFeeHandler, IPauseByID, IRateLimiter), see [`../../../../project-types/console-oft-app/contracts/solana/docs/solana-evm-parity-analysis.md`](../../../../project-types/console-oft-app/contracts/solana/docs/solana-evm-parity-analysis.md).

### Purpose

- Track which EVM functions and types are present, missing, or diverged on the Solana side.
- Provide a structured fact-check baseline for agents and reviewers.
- Distinguish intentional platform adaptations from actual parity bugs.

### Architecture notes

| Concept              | EVM                                                 | Solana                                                                                                   |
| -------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Interface definition | Solidity `interface` with typed function signatures | Rust `InstructionSpec` in macro crate; each instruction is a `.rs` file under `macros/src/instructions/` |
| Param structs        | Inline in function signature or named struct        | Named struct in `oft/src/types.rs`, referenced via `::oft::types::*`                                     |
| Return structs       | Inline tuple or named struct                        | Named struct in `oft/src/types.rs`                                                                       |
| View / state-change  | `view` modifier                                     | `is_view: bool` field in `InstructionSpec`                                                               |
| Array operations     | `T[] calldata` batch params                         | One item per instruction (Solana tx size constraint)                                                     |
| Addresses            | `address` (20 bytes, EVM account)                   | `Pubkey` (32 bytes, Solana account)                                                                      |
| Integer sizes        | `uint256` for amounts/IDs                           | `u64` for token amounts, `u128` for IDs                                                                  |

---

## Agent Fact-Check Rules

> **For agents reading this document to verify or update facts:**

1. **Read source files directly** — do not rely on this document alone. Cross-check every claim against the actual `.sol` and `.rs` files listed in the header.

2. **EVM ground truth** — verify Solidity struct fields, function signatures, and `view` modifiers from the `.sol` files in `node_modules/@layerzerolabs/`. The `upgradeable` package path is:
   `apps/oft-app/contracts/evm/upgradeable/node_modules/@layerzerolabs/`

3. **Solana macro ground truth** — verify `params_type`, `return_type`, and `is_view` from the individual `spec()` functions in `macros/src/instructions/**/*.rs`.

4. **Solana type ground truth** — verify struct fields and types from `apps/oft-app/contracts/solana/oft/src/types.rs`.

5. **Library types** — all interface return types are defined in `oft::types` or primitive/oapp types. There are no consumer-defined interface return types.

6. **Match criteria** — a function pair is "OK" only if ALL three hold:
    - Same `view` / `is_view` value
    - Semantically equivalent params (name + type, accounting for intentional platform adaptations in §2.1)
    - Semantically equivalent return type

7. **Intentional adaptations are NOT bugs** — see §2.1 for the list. Do not flag `uint256` → `u64`, `address` → `Pubkey`, array → single-item, or struct flattening as parity issues.

8. **Update §3.1** whenever a new bug is found or an existing one is fixed. Keep severity labels (`High`, `Medium`, `Low`) consistent with the existing scale.

---

## Table of Contents

1. [IOFT](#1-ioft)
2. [Shared Type Definitions](#2-shared-type-definitions)
3. [Summary of All Differences](#3-summary-of-all-differences)

---

## 1. IOFT

### 1.1 Function-level comparison

| #   | EVM function                                                                                             | Solana instruction                                          | EVM view? | Solana view? | View match? | Params            | Return                           | Sig match?          |
| --- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------- | ------------ | ----------- | ----------------- | -------------------------------- | ------------------- |
| 1   | `oftVersion() → (bytes4 interfaceId, uint64 version)`                                                    | N/A — intentional (§3.3)                                    | view      | —            | —           | —                 | —                                | N/A                 |
| 2   | `token() → address tokenAddress`                                                                         | `token() → Pubkey`                                          | view      | true         | OK          | `None`            | `Pubkey`                         | OK                  |
| 3   | `approvalRequired() → bool requiresApproval`                                                             | N/A — intentional (§3.3)                                    | view      | —            | —           | —                 | —                                | N/A                 |
| 4   | `sharedDecimals() → uint8 sd`                                                                            | `shared_decimals() → u8`                                    | view      | true         | OK          | `None`            | `u8`                             | OK                  |
| 5   | `quoteOFT(SendParam _sendParam) → (OFTLimit, OFTFeeDetail[], OFTReceipt)`                                | `quote_oft(params: QuoteOFTParams) → QuoteOFTResult`        | view      | true         | OK          | `QuoteOFTParams`  | `QuoteOFTResult`                 | OK (see type diffs) |
| 6   | `quoteSend(SendParam _sendParam, bool _payInLzToken) → MessagingFee`                                     | `quote_send(params: QuoteSendParams) → MessagingFee`        | view      | true         | OK          | `QuoteSendParams` | `MessagingFee`                   | OK                  |
| 7   | `send(SendParam _sendParam, MessagingFee _fee, address _refundAddress) → (MessagingReceipt, OFTReceipt)` | `send(params: SendParams) → (MessagingReceipt, OFTReceipt)` | not view  | false        | OK          | `SendParams`      | `(MessagingReceipt, OFTReceipt)` | OK                  |

### 1.2 Param type: `SendParam` (EVM) vs `SendParams` / `QuoteSendParams` / `QuoteOFTParams` (Solana)

EVM `SendParam`:

```solidity
struct SendParam {
    uint32 dstEid;
    bytes32 to;
    uint256 amountLD;
    uint256 minAmountLD;
    bytes extraOptions;
    bytes composeMsg;
    bytes oftCmd;
}
```

Solana `SendParams` (for `send`):

```rust
pub struct SendParams {
    pub dst_eid: u32,
    pub to: [u8; 32],
    pub amount_ld: u64,
    pub min_amount_ld: u64,
    pub extra_options: Vec<u8>,        // EVM: extraOptions
    pub compose_msg: Option<Vec<u8>>,  // None = no compose msg (EVM: bytes)
    pub native_fee: u64,               // from MessagingFee (merged)
    pub lz_token_fee: u64,             // from MessagingFee (merged)
}
```

Solana `QuoteSendParams` (for `quote_send`):

```rust
pub struct QuoteSendParams {
    pub dst_eid: u32,
    pub to: [u8; 32],
    pub amount_ld: u64,
    pub min_amount_ld: u64,
    pub extra_options: Vec<u8>,        // EVM: extraOptions
    pub compose_msg: Option<Vec<u8>>,  // None = no compose msg (EVM: bytes)
    pub pay_in_lz_token: bool,         // merged from separate arg
}
```

Solana `QuoteOFTParams` (for `quote_oft`):

```rust
pub struct QuoteOFTParams {
    pub dst_eid: u32,
    pub to: [u8; 32],
    pub amount_ld: u64,
    pub min_amount_ld: u64,
    pub extra_options: Vec<u8>,        // EVM: extraOptions
    pub compose_msg: Option<Vec<u8>>,  // None = no compose msg (EVM: bytes)
    pub pay_in_lz_token: bool,         // deprecated, kept for backward compat
}
```

**Differences:**

| Field        | EVM                         | Solana                   | Severity    | Notes                                                                                     |
| ------------ | --------------------------- | ------------------------ | ----------- | ----------------------------------------------------------------------------------------- |
| Fee fields   | separate `MessagingFee` arg | merged into `SendParams` | Intentional | Solana merges params for single-ix design                                                 |
| `oftCmd`     | present in `SendParam`      | **absent** from params   | Intentional | Solana passes OFT commands via PDA account, not in params (tx size constraint)            |
| `composeMsg` | `bytes` (empty = none)      | `Option<Vec<u8>>`        | Intentional | Solana uses `Option` to distinguish "no compose" from "empty compose" for backward compat |

### 1.3 Return type: `OFTReceipt`

| Field                                     | EVM       | Solana | Match?                |
| ----------------------------------------- | --------- | ------ | --------------------- |
| `amountSentLD` / `amount_sent_ld`         | `uint256` | `u64`  | OK (Solana token max) |
| `amountReceivedLD` / `amount_received_ld` | `uint256` | `u64`  | OK                    |

### 1.4 Return type: `OFTLimit`

| Field                           | EVM        | Solana     | Match? |
| ------------------------------- | ---------- | ---------- | ------ |
| Struct name                     | `OFTLimit` | `OFTLimit` | OK     |
| `minAmountLD` / `min_amount_ld` | `uint256`  | `u64`      | OK     |
| `maxAmountLD` / `max_amount_ld` | `uint256`  | `u64`      | OK     |

### 1.5 Return type: `OFTFeeDetail`

| Field                           | EVM               | Solana          | Match? |
| ------------------------------- | ----------------- | --------------- | ------ |
| `feeAmountLD` / `fee_amount_ld` | `int256` (signed) | `i128` (signed) | OK     |
| `description`                   | `string`          | `String`        | OK     |

### 1.6 Return type: `QuoteOFTResult` (Solana wrapper)

Solana wraps the EVM tuple `(OFTLimit, OFTFeeDetail[], OFTReceipt)` into:

```rust
pub struct QuoteOFTResult {
    pub oft_limit: OFTLimit,
    pub oft_fee_details: Vec<OFTFeeDetail>,
    pub oft_receipt: OFTReceipt,
}
```

This is structurally equivalent.

---

## 2. Shared Type Definitions

### 2.1 Intentional Solana adaptations (NOT bugs)

These are expected platform differences:

| Pattern       | EVM                  | Solana              | Reason               |
| ------------- | -------------------- | ------------------- | -------------------- |
| Token amounts | `uint256`            | `u64`               | SPL tokens use `u64` |
| Addresses     | `address` (20 bytes) | `Pubkey` (32 bytes) | Solana native        |

---

## 3. Summary of All Differences

### 3.1 Bugs / Parity issues requiring fix

No open issues.

### 3.2 Naming inconsistencies (cosmetic)

None.

### 3.3 Intentional platform adaptations (no action needed)

| #   | Pattern                                   | Notes                                                                                                  |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | `uint256` → `u64`                         | Solana native sizes                                                                                    |
| 2   | `address` → `Pubkey`                      | Solana addresses                                                                                       |
| 3   | Merged fee/pay args into param structs    | Solana single-ix design                                                                                |
| 4   | No `oftVersion()` function                | Not applicable — Solana programs use a different versioning model                                      |
| 5   | No `approvalRequired()` function          | Not applicable — SPL token model has no ERC-20-style approve/transferFrom                              |
| 6   | `oftCmd` absent from Solana param structs | Solana passes OFT commands via a separate PDA account instead of embedding in params (backward compat) |
| 7   | `composeMsg` as `Option<Vec<u8>>`         | Solana uses `Option` to distinguish "no compose" from "empty compose"; EVM uses empty `bytes`          |
