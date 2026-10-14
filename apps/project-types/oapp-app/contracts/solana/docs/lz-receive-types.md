# Receive planning (LzReceiveTypes V3)

`lz_receive` accounts depend on the message, so the OApp computes them on-chain: the Executor
simulates the OApp's planner and receives an ordered list of instructions to submit. V3 is the
planner version `lz_receive_types_info` reports; it is unrelated to Solana's transaction format
version. The `#[oapp]` interface includes only `lz_receive_types_v3`.

**Intended use: simulation only.** Read the plan from the simulation response. Do not submit the
planner transaction, persist its output, or read the scratch account later with `getAccountInfo`.
Nothing on-chain prevents a submission; one would leave a rent-funded scratch account that no
instruction closes.

## Flow

1. Simulate `lz_receive_types_info(params)` with accounts
   `[receiver, PDA([b"LzReceiveTypes", receiver])]`. Return data is Borsh
   `(3u8, LzReceiveTypesV3Accounts { accounts: Vec<Pubkey> })`: the planner's app-specific inputs,
   readonly and in ABI order, including Anchor optional-account sentinels. Return data is capped at
   1,024 bytes and this encoding takes `5 + 32 * accounts.len()`, so at most 31 inputs fit.
2. Create the scratch account with a new keypair in a **top-level** `SystemProgram::create_account`
   owned by the OApp program.
3. Simulate `[create, lz_receive_types_v3(params)]` with accounts
   `[payer (signer, writable), scratch (signer, writable), ...inputs]`, requesting the scratch
   post-state through RPC `accounts.addresses` with base64 encoding and enough heap for the
   planner (the staged SDK requests 256 KiB).
4. Return data is a Borsh `u32`: the plan's encoded length. If the scratch is at least that long,
   decode `data[..length]` as `LzReceiveTypesV3Result { context_version, instructions }`.
   Otherwise nothing was written; see [Sizing the scratch](#sizing-the-scratch).
5. Resolve and submit the plan. `lz_receive` revalidates live state; the scratch is never a
   delivery input.

The scratch holds only the Borsh plan, at offset 0 — no header, completion marker or request hash —
so its contents mean something only within the simulation response that produced them. A client
should check simulation success, that return data comes from the planner program, the scratch
owner, the reported length against its own budget, and that the payload decodes exactly.

## Planner obligations

The Executor trusts the plan only as far as these hold, so an OApp's planner must:

- Declare `payer` and `plan_out` as its first two accounts, both `Signer` and `mut`: the Executor
  passes them in those slots, and `lz_receive_types_info` reports only the inputs after them.
- Write the plan only through `oapp::lz_plan::write`, which rejects a scratch that is not writable,
  not owned by the program, or not all zero.
- Plan the accounts `lz_receive` declares, in declaration order, then the Endpoint `clear` accounts
  from `oapp::lz_receive_types_v3::get_accounts_for_clear`, then any further remaining accounts
  `lz_receive` forwards, and have `lz_receive` check the peer and clear through them. Clearing is what proves the message was verified and
  consumes it.

## Sizing the scratch

The planner never allocates or resizes the scratch, and a top-level create is not bounded by
`MAX_PERMITTED_DATA_INCREASE`, so the caller picks the size. The planner reports the plan length
whether or not it fit, so the first simulation doubles as the measurement: if the scratch was too
small, re-create it at the returned size and simulate again. The staged SDK starts at
`DEFAULT_PLAN_SCRATCH_BYTES` (4,096) and bounds both the size and the number of attempts. A plan
that fits the scratch can still exceed transaction, account or compute limits at delivery.

## Plan

Instructions are `LzReceive { accounts }` (the delivery, called with the original params) or
`Standard { program_id, accounts, data }`. They run in order in one transaction, and clients reject
a plan without exactly one `LzReceive`. Each account is an `AccountMetaRef` — an `AddressLocator`
plus a writable flag. Locators are `Address(Pubkey)`, `Payer`, `Signer(u8)` (an Executor-provided
extra signer; equal indices are the same key across the plan) and `Context` (the Executor's
execution-context account for `context_version`). Only `Payer` and `Signer` are signers. An
`Address` descriptor encodes to 34 bytes.

Planner handlers write with [`lz_plan::write`](../src/lz_plan.rs) and return its `u32`; the formats
are in [`lz_receive_types_v3.rs`](../src/lz_receive_types_v3.rs) and [`common.rs`](../src/common.rs).
The reference client is `@layerzerolabs/lz-v2-protocol-solana/v3`
([`plan-v3.ts`](../../../../../../packages/protocol/lz-v2-protocol-solana/src/plan-v3.ts)).
