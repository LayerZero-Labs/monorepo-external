---
owner: shankar
reviewed: 2026-09-18
---

# Resource budget — ceilings and plan sizing

Where the Solana ceilings sit for a Console OFT transaction, which one binds, and how the receive
plan scratch is sized. Measured CU, account counts and wire bytes are in the
[send/receive profile](./send-receive-profile.md); this document does not repeat them.

The binding constraint is **account addresses**. The largest profiled send uses 44 of 64 and the
largest receive envelope 38, while compute (≤341k of 1.4M) and bytes (≤1,756 of 4,096) keep more
headroom.

## Ceilings

This package compiles both directions as Transaction V1 with no address lookup tables; an
over-budget transaction fails client-side with Kit's `TOO_MANY_ACCOUNT_ADDRESSES`. ALTs would not help anyway:
they compress bytes, and every resolved address still takes a lock.

Receive has a planner (`lz_receive_types_info` / `lz_receive_types_v3`); send does not, so each
send client assembles the account list itself.

| Limit             | Value                       | Notes                                       |
| ----------------- | --------------------------- | ------------------------------------------- |
| Account addresses | **64**                      | Format constant, see below. The binding one |
| Transaction size  | 4,096 bytes                 | SIMD-0296                                   |
| Compute units     | 1,400,000                   |                                             |
| Heap              | 32 KiB default, 256 KiB max | Executor always requests the max, see below |

V1 encodes every address inline at 32 bytes, so addresses and payload compete for the same 4,096.

## Plan scratch — how big the caller makes it

The planner does not allocate. The client creates the scratch itself, in a **top-level**
`SystemProgram::create_account` ahead of the planner instruction, with a throwaway keypair. Being
top-level rather than a CPI is what lets it be any size — `MAX_PERMITTED_DATA_INCREASE` bounds
`realloc`, not a top-level create. The SDK only simulates this transaction (`sigVerify: false`) and
never signs for the throwaway key; nothing on-chain prevents a signed submission.

The planner writes the Borsh plan at offset 0 and returns its length as a `u32`, **whether or not
it fit**. So the first simulation is also the measurement: a returned length larger than the
account means nothing was written and the caller re-simulates with a bigger one.

Three consequences integrators get wrong:

- **The plan is a prefix.** Read `data[..returned]`; the rest of the account is zero. The
  account's own length is the caller's choice and says nothing about the plan.
- **The scratch must arrive all-zero.** A plan is never written over an earlier one's tail, and a
  populated program-owned account — an OApp's keypair-addressed state, say — cannot be passed in
  and overwritten. `lz_plan` also requires the scratch to sign.
- **Read it from the same successful simulation.** The account only ever exists inside that
  simulation; there is nothing to fetch afterwards.

### The formula

Borsh sizes, **counted** from `LzReceiveTypesV3Result` in `oapp/src/lz_receive_types_v3.rs`:

| Term                       | Bytes | What it covers                                                 |
| -------------------------- | ----- | -------------------------------------------------------------- |
| base                       | 5     | `context_version: u8` + the instruction vector's length prefix |
| per instruction            | 5     | enum tag + that instruction's own account-vector length prefix |
| per account meta           | 34    | `AddressLocator::Address(Pubkey)` + `is_writable`              |
| per `Standard` instruction | +36   | program id + data-length prefix                                |
| `Standard` data            | +len  | verbatim                                                       |

```
bytes = 5 + 5·instructions + 34·accounts + 36·standardInstructions + standardDataBytes
```

34 is the worst case per meta: `Payer` and `Context` locators cost 2 and `Signer` costs 3, so the
formula over-estimates and never under-estimates. For the profile's 32-meta `policy-only` plan it
gives 1,098 against the measured 1,066 — the 32-byte gap is the one `Payer` locator.

`estimatePlanBytes()` in `plan-v3.ts` is this formula; `planScratchBytes()` rounds it up to 512 so
a plan that drifts by a few bytes still fits the size you picked.

### Just use the default

`DEFAULT_PLAN_SCRATCH_BYTES = 4096` holds a single-instruction plan of up to 120 literal-address
metas (5 + 5 + 34 × 120 = 4,090), about twice the largest profiled plan (60 metas, 1,954 bytes).
Metas count per instruction, duplicates included, so the address ceiling does not bound plan size;
a larger plan costs one extra simulation.

The formula matters when a plan is deliberately larger than the transaction that will carry it —
the 400-extras hook test is the only such case here — or when an integrator is writing their own
client and wants to know the number rather than trust a constant.

### What it costs

The scratch must be rent-exempt inside the simulation, so the payer's **real** balance has to
cover it even though nothing is spent: `(128 + space) × 6,960` lamports, or **0.0294 SOL** at the
4,096-byte default (**counted**, standard rent parameters). At the 65,536-byte ceiling
`maxPlanBytes` allows, that is 0.457 SOL. An Executor payer clears both; a thinly-funded
integrator key may not, and the failure is `InsufficientFundsForRent` on the create, not a
planner error.

## DVN scaling

The ULN lays out `remaining_accounts` as `[executor_program, executor_config, price_feed_program,
price_feed_config]` then, per DVN, `[dvn_program, dvn_config, price_feed_program,
price_feed_config]` — asserted `accounts.len() == length * 4`
(`uln/src/instructions/endpoint/send.rs`, `quote.rs`).

Four **slots** per DVN, but `price_feed_config` is caller-supplied and validated against
`dvn_config.price_feed` (`dvn/src/instructions/quote.rs`), a mutable field each operator sets
independently. So whether those slots are _unique_ is an operator choice, not a protocol property.

**Measured on mainnet, live RPC (2026-09-18):** all 23 DVN orgs in `lz-metadata` run distinct DVN
program deployments — `DVN_CONFIG_SEED` is org-independent, so each org must deploy its own
instance to get a singleton config — but **23 of 23 point `price_feed` at the same account**,
`CSFsUupvJEQQd1F4SsXGACJaxQX4eropQMkGV2696eeQ`, under the one canonical pricefeed program
`8ahPGPjEbpgGaZx2NV1iG5Shj7TDwvsjkEDcGWjt94TP`. A real simulated send shows the DVN reusing the
Executor's price-feed account indices rather than allocating fresh ones, so the sharing is
DVN↔Executor as well as DVN↔DVN.

|                      | Value                                | Basis                                                              |
| -------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| Per-DVN unique cost  | **2** (`dvn_program` + `dvn_config`) | code + live RPC, 23/23                                             |
| Per-DVN slot layout  | 4                                    | code                                                               |
| Executor unique cost | 2 (shares the price feed)            | code                                                               |
| Default `SendConfig` | **4 required, 0 optional**           | live RPC across Ethereum, BSC, Avalanche, Arbitrum, Base, Optimism |

So `unique_send = base + 2D`. A theoretical unshared regime (`base + 4D`) exists in the code
layout — nothing stops a DVN admin pointing at their own pricefeed — but **zero of 23 mainnet
deployments exhibit it**.

**Consequence: D is not the variable that binds.** From the largest profiled send (44 keys with one
DVN), reaching 64 takes about 11 DVNs against a mainnet default of 4. The fixed base is what
consumes the budget.

## The 64 is a format limit, and nothing we control can raise it

Two independent constants, checked in separate functions:

```rust
// message/src/versions/v1/mod.rs @ 65df8198
pub const MAX_ADDRESSES: u8 = 64;              // V1 wire-format sanitize; not parameterized

// transaction/src/sanitized.rs @ 4607a40e
pub const MAX_TX_ACCOUNT_LOCKS: usize = 128;   // runtime, supplied as a parameter
```

V1's `validate()` rejects `num_account_keys > MAX_ADDRESSES` **before**
`Bank::get_transaction_account_lock_limit` is ever consulted, so the runtime lock limit is not
what binds us — the format constant is. `@solana/kit`'s V1 compiler enforces the same 64
independently (`packages/transaction-messages/src/compile/v1/message.ts` @ `7f02d239`), under an
error named `TOO_MANY_ACCOUNT_ADDRESSES`.

Two consequences, both worth stating because both are common wrong assumptions:

- **Activating `increase_tx_account_lock_limit` would not help.** It raises the runtime limit,
  which V1 never reaches.
- **ALTs would not help even if we used them.** They compress the encoded transaction; every
  resolved address still takes a lock. Byte budget and address budget are independent.

### SIMD-0596 — the only thing that can raise our ceiling

[solana-improvement-documents#596](https://github.com/solana-foundation/solana-improvement-documents/pull/596),
"Increase TxV1 Account Lock Limit to 96". Raises V1 to 96 addresses, keeps legacy/v0 at 64.
Status `Draft`, feature key unfilled, approved by both Anza and Firedancer, **no activation
timeline**.

> The `increase_tx_account_lock_limit` feature, which raises the account lock limit to 128, MUST
> be removed before this proposal's feature is introduced.

> Extending the higher account limit to legacy and v0 transactions was also considered. The goal
> is to eventually remove support for these formats […] Limiting the increase to v1 encourages
> applications to migrate to the newer format.

Since this pipeline is V1-only, 0596 is the single lever that changes our ceiling, and there is
no fallback format to migrate to if it stalls. At 96, the largest profiled send (44 keys) would
leave 52 addresses free.

Byte trade at high counts: 96 × 32 = 3,072 bytes of addresses, leaving 1,024 of the 4,096 for
signatures, header, instructions and data. A transaction near the address ceiling will be
byte-constrained too.

**Until it activates, 64 is fixed for us.** The only lever we hold is reducing the account count.

## Heap

The test harness sets `svm.compute_budget.heap_size = 256 * 1024`
(`tests/integration/harness.rs`). This **mirrors production**, it is not a defensive test
artifact: Transaction V1 carries the heap budget in its message config, and
`compileTransactionV1` (`packages/protocol/lz-v2-protocol-solana/src/transaction-v1.ts`)
defaults it to 256 KiB for every transaction it compiles, regardless of instruction shape.

Whether the program would actually overflow the default 32 KiB is **unknown**; no test runs at the
default size, and mollusk exposes no heap high-water mark. The only heap-stress test
(`oversized_plan_reports_the_size_to_re_simulate_with`, 400 literal extras) is a pathological
case, not the normal path.
