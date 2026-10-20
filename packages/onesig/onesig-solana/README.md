# @layerzerolabs/onesig-solana

The multicall OneSig program for Solana. See [`AUDIT.md`](./AUDIT.md) for the design and the
security-relevant mechanisms, and [`docs/solana-onesig-transaction-notes.md`](./docs/solana-onesig-transaction-notes.md)
for the transaction-shape notes.

This package is program-only: Anchor program sources, Rust tests, IDL build outputs, audit
documentation, and snapshot lockfile checks. It exports no JavaScript. The TypeScript SDK
lives in [`@layerzerolabs/onesig-solana-sdk`](../onesig-solana-sdk).

This is the canonical package, promoted from `@layerzerolabs/onesig-solana-staged`. The previous
implementation is preserved in [`../onesig-solana-archived`](../onesig-solana-archived).

## Toolchain

The program builds as SBPF v3 with Anchor 1.2.1 and Solana 4.3.0 (`Anchor.toml` `[toolchain]`).
The build scripts pass `--tools-version v1.57 --arch v3` to `anchor build`, so the architecture and
platform-tools version do not depend on Anchor's defaults. `target/deploy/onesig.so` has ELF
`e_flags` = 3, and [`test/sbpf-version.test.ts`](test/sbpf-version.test.ts) checks it.

SBPF v3 stack frames are a fixed 4 KiB with no guard gap, and the compiler only warns when a
function overflows its frame. `build:anchor`, `build:anchor:native`, and
`build:anchor:heap-profiling` run `anchor build` through `scripts/sbf-build.sh`, which fails the
build when the output reports `overflows the maximum allowed frame space`.
[`test/sbf-build-guard.test.ts`](test/sbf-build-guard.test.ts) checks the guard and this wiring.

## Program identity

The default deploy address is **`6VhT6ASR4Ytg2AZbrKAcn1YFzRwaUJ2ANiTB9hueVPpr`**, overridable at
build time.

`target/deploy/onesig-keypair.json` is an unrelated throwaway that `anchor build` generates and
`--ignore-keys` never reconciles.

## Building with a different address

`programs/onesig/src/lib.rs` declares the address with `declare_program_id!`, which reads
`ONESIG_STAGED_ID` and falls back to the literal above.

```sh
pnpm exec lz-tool --env ONESIG_STAGED_ID=<pubkey> --script 'bash scripts/sbf-build.sh anchor build --ignore-keys --no-idl --tools-version v1.57 --arch v3' anchor
pnpm exec lz-tool --env ONESIG_STAGED_ID=<pubkey> --script \
  'anchor idl build -p onesig -o build/onesig.json && add_address_to_idl.py --idl-dir build' anchor
pnpm --filter @layerzerolabs/onesig-solana-sdk compile:sdk
```

- Both steps need the same value. They run in separate containers, and if they disagree the SDK
  addresses a different program than the one built — a program ID cannot be patched into a `.so`.
- `add_address_to_idl.py` is required. `anchor idl build` recovers the address by text-matching
  `declare_id!`, so a non-literal one yields the macro's source text, which codama copies into
  `ONESIG_PROGRAM_ID`.

The `ONESIG_STAGED_ID` override retains its original name for build compatibility.

`ONESIG_STAGED_ID` is unset in CI, so CI builds the default address and `turbo-snapshot.lock.json`
stays deterministic.

## Common commands

- `pnpm build`
- `pnpm test:rs`
- `pnpm test:js`
- `pnpm lint`
- `pnpm format`
- `pnpm test:snapshot:check`
