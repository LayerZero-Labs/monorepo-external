# Console OFT tests

| Lane                                                   | Location                                       | Runs                  |
| ------------------------------------------------------ | ---------------------------------------------- | --------------------- |
| Program rules (Mollusk)                                | `programs/console_oft/tests/*.rs`              | `pnpm test:mollusk`   |
| Cross-program integration (Mollusk, real SBF programs) | `tests/integration/`                           | `pnpm test:rust`      |
| SDK and harness unit tests                             | `tests/sdk/*.test.ts` (`vitest.sdk.config.ts`) | `pnpm test:sdk`       |
| Live validator (surfpool)                              | `tests/*.test.ts` (`vitest.config.ts`)         | `pnpm test:validator` |

Program-state rules — fees, pause, rate limits and exemptions, credit redirect routing, pubkey policy
boundaries, planner account order, admin rotation — belong in the Rust lanes. The validator lane keeps
only what needs a real runtime, real Transaction V1 wire bytes and the real Endpoint, ULN, DVN and
Executor:

- `send-receive.test.ts`: send → verify + commit → Executor-planned receive for SPL LockUnlock, SPL
  BurnMint and Token-2022 BurnMint, including net accounting of the inflow.
- `acl-receive.test.ts`: the largest supported receive (canonical ACL, pubkey-policy hook, compose
  payload, credit redirect) lands as one Transaction V1 without address lookup tables, for an eligible
  recipient (created, thawed, credited) and a blacklisted one (redirected, zero reported).
- `compose.test.ts`: send-and-call → ComposeSent → Executor-planned `lz_compose`.

## Transaction V1 only

Every transaction a validator test submits — setup, admin configuration, send, DVN verification,
receive and compose — goes through `helpers/transaction-v1.ts` (`sendV1`, `simulateV1`), which
compiles Transaction V1 with the protocol package's `compileTransactionV1`. Do not use Umi's
`TransactionBuilder.sendAndConfirm`, the shared `sendAndConfirm` from `@layerzerolabs/test-utils-solana`
(both serialize legacy/V0 messages), address lookup tables, or ComputeBudget instructions; set budgets
through `V1TransactionConfig`. `sendV1` errors carry the program logs in `.logs`, so the shared
`expectOftError` / `expectErrorMessage` assertions match Anchor error codes.

The shared global setup still builds `target/base.json` (the protocol state every validator boots
from) with the shared V0 `sendAndConfirm`, on a separate validator; no test validator executes those
transactions.

## Fixtures

`helpers/fixture.ts` creates one OFT per call: a fresh mint (SPL or Token-2022, with only the
extensions a test asks for), an initialized store wired as a loopback pathway on DST_EID/SRC_EID, and
a globally disabled rate limiter. Anything else a test needs (net accounting, ACL governance, a hook
manifest, credit redirect) is configured in the test body.
