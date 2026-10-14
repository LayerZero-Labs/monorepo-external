# Console OFT cross-program suite

Run `pnpm test:rust` (or `pnpm test:policy` for this suite plus `oft_pubkey_policy`) from the
Console OFT Solana package. It builds the SBF fixtures through `lz-tool`, then runs the OFT's
unit and Mollusk tests and this suite.

## Layers

| Layer         | Where                          | Proves                                                                                                                                 |
| ------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | `#[cfg(test)]` beside the code | codecs, debit (fee, dust, slippage), fee inverse, rate-limit transitions                                                               |
| Program       | `programs/console_oft/tests`   | one program's boundaries: role gates, configuration lifecycles, views, receive planning, policy account resolution, hook-group framing |
| Cross-program | this crate                     | the pieces composing under the real runtime                                                                                            |

This crate runs real SBF binaries — OFT, TokenManager, pubkey policy and its transfer hook, the
canonical Token ACL, Token-2022, ATA, Endpoint, SimpleMessageLib (and ULN302/DVN/Executor/price
feed for the budget tests), plus the test composers and hook fixture. Mints, roots, policies, ACL
registration, manifests and memberships are created through program instructions; Endpoint
verification state is seeded, and the OFT store is a fixture except in `deploy.rs`, which runs
`init_console_oft` and the rest of the setup order through the real programs. Transactions use Mollusk's transaction API, which is atomic: the harness asserts that
a failed transaction leaves every account unchanged. This is delivery testing, not DVN/network
testing, and Mollusk does not build wire transactions: `budget.rs` checks Transaction V1's
64-address limit by count, and `scripts/profile-acl.ts` compiles the emitted instructions into
real V1 envelopes.

## Modules

- `harness.rs` — the `Harness` (a BurnMint Token-2022 OFT; ACL, hook and PermissionedBurn are
  constructor switches), receive planning in the Executor's order (info → planner → plan →
  execute), and delivery assertions.
- `send.rs` — pause, slippage, LockUnlock supply, fee deposit, rate-state selection, source
  authority, PermissionedBurn path selection and rollback, hook-group framing.
- `receive.rs` — first-time and existing recipients, peer authentication, inbound limits, inline
  ACL activation vs. redirect vs. `CreditBlocked`, griefing by omitted/malformed inputs, binding
  drift, live policy after planning, hook manifests, and the ACL + hook + compose junction.
- `compose.rs` — a composer activating a destination the OFT knows nothing about.
- `admin.rs` — initialization, policy binding, messaging-channel roles, Endpoint delegate sync.
- `budget.rs` — plan transport through scratch, Transaction V1 address fit (receive and
  compose-then-send), CPI depth, and the CU/key profiles `scripts/profile-acl.ts` consumes.
- `deploy.rs` — deploying an OFT for one token configuration through the real programs only,
  following `docs/usage.md`'s setup order.
- `configurations.rs` — each supported token configuration, deployed and round-tripped (a first
  receive to a new recipient and a send back).
- `account_extensions.rs` — owner-enabled token-account extensions (MemoTransfer, CpiGuard, …) on
  every account the OFT touches.
