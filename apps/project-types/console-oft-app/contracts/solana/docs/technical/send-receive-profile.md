# Send and receive resource profile

Measured 2026-09-26 on SBF programs built by `pnpm build:test-fixtures` at `c297c9f742`.
This is a fixture profile, not a network capacity claim.

## Send

| Fixture                    | Send CU | Raw metas | Unique keys | V1 bytes | CPIs | Depth |
| -------------------------- | ------: | --------: | ----------: | -------: | ---: | ----: |
| `burn-mint-simple`         | 106,829 |        33 |          27 |    1,186 |    6 |     3 |
| `burn-mint-uln`            | 196,003 |        46 |          36 |    1,487 |   11 |     5 |
| `burn-mint-hook-uln`       | 246,497 |        53 |          42 |    1,686 |   12 |     5 |
| `pb-hook-uln`              | 262,917 |        53 |          46 |    1,814 |   14 |     5 |
| `pb-hook-fee-uln`          | 314,569 |        60 |          47 |    1,853 |   16 |     5 |
| `lock-unlock-uln`          | 192,644 |        46 |          36 |    1,487 |   10 |     5 |
| `lock-unlock-hook-fee-uln` | 293,094 |        60 |          43 |    1,725 |   13 |     5 |

`pb` means active PermissionedBurn with the canonical manager approver; `hook` is the
first-party pubkey-policy hook. Fee cases charge 10% of a 100-unit send: 90 units bridge and
10 go to the fee deposit. All others bridge 100 units. The source is an existing funded ATA.

ULN rows execute the real Endpoint, ULN302, one DVN, Executor quote and shared pricefeed
binaries. Worker prices are configured to quote zero native fees, so nonzero worker-payment
transfers are not included. The simple-library row is a comparison, not a ULN estimate.

All sends have two signature slots (payer and source owner). Unique keys include the program
and payer; there is no Executor pre/post bracket on send.

## Receive

| Fixture                    | Planner CU | Receive CU | Raw metas | Body / envelope keys | V1 bytes | Plan bytes | CPIs |
| -------------------------- | ---------: | ---------: | --------: | -------------------: | -------: | ---------: | ---: |
| `policy-only`              |     86,809 |    106,840 |        32 |              23 / 26 |    1,159 |      1,066 |   10 |
| `acl-new`                  |    112,811 |    160,554 |        35 |              29 / 32 |    1,354 |      1,168 |   15 |
| `acl-existing`             |    112,812 |    104,168 |        35 |              29 / 32 |    1,354 |      1,168 |    5 |
| `acl-hook-compose`         |    144,313 |    234,517 |        63 |              36 / 39 |    1,639 |      2,056 |   19 |
| `acl-hook-compose-blocked` |    144,313 |    206,372 |        63 |              36 / 39 |    1,639 |      2,056 |   15 |
| `lock-unlock`              |     86,810 |    103,594 |        32 |              23 / 26 |    1,159 |      1,066 |    9 |
| `lock-unlock-hook`         |     98,192 |    154,032 |        39 |              27 / 30 |    1,294 |      1,304 |   10 |

All receive rows reach depth 3 and use one payer signature. All except `acl-existing`
create a recipient ATA. The first five rows use BurnMint; the last two unlock funded escrow.
Receive amount is 1,000 raw units. Compose cases include both recipient and redirect account
candidates and a short payload; the blocked case selects the redirect. They enqueue compose
through Endpoint; they do not execute the later composer transaction.

Planner CU is a separate simulation, not part of delivery CU. Plan bytes are serialized
planner output, not transaction bytes. The envelope adds the SDK's Executor pre/post instructions
to the exact emitted receive instruction.

## What the measurements establish

- The largest tested send is PB + hook + fee + ULN: 314,569 CU, 47 keys, 1,853 V1 bytes.
  The largest tested receive is new ACL ATA + hook + compose candidates: 234,517 delivery CU,
  39 envelope keys, 1,639 V1 bytes. These are maxima of this matrix, not universal maxima.
- The controlled simple-library → ULN change costs 89,174 CU and 9 keys. In BurnMint ULN,
  the hook adds 50,494 CU and 6 keys; permissioned burn adds 16,420 CU and 4 keys;
  charging the fee adds 51,652 CU and 1 key.
- For otherwise identical ACL receive fixtures, an existing activated ATA saves 56,386 CU
  and 10 CPIs. Inline activation is therefore a real first-receive cost, not steady-state cost.
- Direct ULN sends pass with the runtime depth limit explicitly set to 5 and reach 5.
  This does not prove nested composer sends fit that limit. The separate
  `multihop_send_is_correct_but_needs_simd_0268_cpi_depth` regression checks the nested
  path at configured limits 5 and 6; its name is not evidence of current network feature activation.

## Scope and limits

All fixtures use Token-2022 and an active global limiter (both directions and net accounting
enabled, 1,000,000-unit limits, 60-second windows). No-op globally disabled limiter paths would
understate hot-path cost. Both custody modes are covered; this is not an exhaustive feature
cross-product or a legacy-token comparison.

CU is measured by Mollusk executing SBF. CPI counts include all recorded inner instructions,
including events and ATA initialization. The 256 KiB heap is the **configured budget**, not a
measured peak allocation. It is not an assertion that these paths work with the default heap.

Wire bytes come from the repository's canonical V1 compiler, including signature slots,
without ALTs or synthetic ComputeBudget instructions. Transactions are compiled, not signed
or submitted. This does not establish V0/legacy wire size or live V1 availability. Receive
Executor pre/post instructions are compiled but **not executed**; their CU is excluded.
Pre-delivery DVN verification and setup/funding transactions are also excluded.

Remaining targeted profiles: deployment-specific DVN counts/prices, nonzero worker payments,
long compose payloads, third-party hook programs, measured heap high-water use, and actual
Executor submission on the target runtime. The TS compiler is used only to measure wire format.

## Reproduce

From this package, build the SBF fixtures and then run:

```sh
pnpm build:test-fixtures
node --import tsx scripts/profile-acl.ts --include-send
```

The script emits 14 JSON rows; omit `--include-send` for the 7 receive rows. To execute only
the Rust measurements without compiling wire envelopes:

```sh
pnpm exec lz-tool --script 'RUST_LOG=off cargo test -p console-oft-integration-tests --locked \
  --test integration resource_profile -- --nocapture' anchor
```

Fixture definitions and assertions: [budget.rs](../../tests/integration/budget.rs)
(`inline_acl_resource_profile`, `send_resource_profile`, `install_uln`) and
[harness.rs](../../tests/integration/harness.rs) (`configure_profile`).
Wire compiler: [profile-acl.ts](../../scripts/profile-acl.ts).
The tests enforce receive <350k CU / depth ≤4 / delivery keys that fit 64 addresses with the
Executor bracket, and send <400k CU / depth ≤5;
the wire compiler separately enforces its address and byte limits.

Build: `solana-cargo-build-sbf 3.1.10`, platform-tools `v1.52`, SBF rustc `1.89.0`.
Measured `console_oft.so` SHA-256:
`23d038d1133835cc87582079f304bc70523e48990a89909310844092051127f2`.
