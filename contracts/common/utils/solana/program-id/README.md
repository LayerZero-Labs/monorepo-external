# @layerzerolabs/program-id-solana-contracts

A cargo-tracked replacement for `solana_helper::program_id_from_env!`, for Solana programs whose
address is supplied at build time.

## Usage

```rust
use anchor_lang::prelude::*;
use program_id::declare_program_id;

declare_program_id!("OFT_ID", "9UovNrJD8pQyBLheeHNayuG1wJSEAoxkmM14vw5gcsTT");
```

Takes the program ID from `$OFT_ID`, falling back to the literal. Expand it in a crate that has
`anchor_lang::prelude::*` in scope.

## Problem

`program_id_from_env!` is a proc macro that calls `std::env::var` while it expands. Cargo's
fingerprint cannot observe that read, so a rebuild with a different value recompiles nothing and
re-emits the program ID from the previous build. Nothing fails loudly — the `.so` carries the wrong
address.

That artifact cannot be repaired after the fact. A program ID is folded into `.text` as BPF `lddw`
immediates at ~150 sites, and Anchor const-evaluates the `__event_authority` bump from it, so
changing it is a compilation process, not a patch.

## How it works

`declare_program_id!` expands the `declare_id!` alongside an `option_env!($var)` marker. rustc
records that marker as an environment dependency of the calling crate, so cargo rebuilds whenever
the variable changes.

The crate does not depend on `anchor-lang`, so it cannot force an anchor version on a consumer.

## Adopting it

- **Repair the IDL.** `anchor idl build` recovers the address by text-matching `declare_id!`, so any
  non-literal form yields a garbage `address` field. Chain `add_address_to_idl.py --idl-dir <dir>`
  (present in the anchor image) after it, which re-derives the address via `cargo expand`.
- **Pass the variable to every step.** The compile and the IDL build are separate `lz-tool`
  invocations; both need the same value or the `.so` and the IDL disagree.
- **Pass it with `lz-tool --env`, not cargo's `[env]` table.** `[env]` does not override a variable
  already set in the process environment, and `--config` cannot express `force = true`.
- **Expect a new `.so`.** The marker adds no bytes to the artifact, but replacing a literal
  `declare_id!` shifts source lines, which moves `panic::Location` constants.

## Tests

- `pnpm test:rebuild` — builds `tests/probe` twice with different IDs without cleaning, and fails if
  the second build does not follow. Deleting the `option_env!` marker makes it fail.
- `pnpm test:idl-shape` — expands the probe and asserts `add_address_to_idl.py`'s matcher recovers
  the probe's declared ID.
- `pnpm test:unit` — default fallback and base58 decoding.
