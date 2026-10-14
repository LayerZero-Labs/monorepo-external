# Transfer-hook account contract

OFT send, receive and the forwarding composer share
[`TransferHookAccounts`](../../programs/console_oft/src/helpers/transfer_hook_accounts.rs).
It owns account-group framing and native forwarding, not token authorization or hook policy.
The mint's live hook extension selects the program; optional caller accounts cannot disable it.

| Live configuration                 | OFT/composer wire group     | Accounts supplied to native transfer helper |
| ---------------------------------- | --------------------------- | ------------------------------------------- |
| No hook                            | Empty                       | Empty                                       |
| Canonical manifest unallocated     | Program, manifest witness   | Program only                                |
| Initialized manifest, zero entries | Program, manifest           | Program, manifest                           |
| Initialized manifest, N entries    | Program, manifest, N extras | Entire group                                |

An absent witness must have the canonical PDA, System ownership, empty data and not be executable.
An initialized manifest must have the canonical PDA, hook-program ownership, valid Execute TLV
and not be executable. The hook program must match the mint and be executable at execution.
Missing, wrong, short or malformed inputs are errors, not evidence of absence. SPL parses any
manifest supplied to its CPI helper, so an unallocated witness must be removed there; a valid
zero-entry list must not be removed.

`take_prefix` returns one complete group and an unconsumed tail. Send uses this for its source
transfer, optional fee transfer, then Endpoint accounts. `parse_exact` rejects trailing accounts.
Receive validates both the recipient and the redirect group, whichever route live state selects.
Native SPL resolves and validates the selected group's extra identities and privileges against the
actual transfer. Endpoint clear/compose groups and PB fixed accounts are separate.

Clients and CPI callers build every group with the canonical witness, including for an unallocated
manifest; the maintained TS send helper does. Only `TransferHookAccounts::cpi_accounts()` goes to a
native transfer helper, never the wire group.

## Planning destinations

[`TransferHookDestination`](../../programs/console_oft/src/helpers/transfer_hook_plan.rs) keeps the
real destination address separate from available seed bytes. A missing ATA contributes its actual
address and a synthetic 64-byte mint/owner prefix. `AccountKey(2)` therefore uses the destination,
not a source-account placeholder. Reads past the supplied prefix fail. Existing account data can
be supplied directly. Previously resolved extras contribute keys, not fetched account data.

This does not promise arbitrary mutable-data seed stability or extra signer discovery. Native
Token-2022 may update account data before invoking the hook; callers must use supported recipes
and replan after relevant configuration changes. The first-party policy hook's manifest resolves
owner and authority subject records.

The test composers take the mint as a `lz_compose_types_info` input and name its manifest (or the
`None` sentinel) during discovery. They are test fixtures, not a production composer template.

## Evidence

[`transfer_hook_contract.rs`](../../programs/console_oft/tests/transfer_hook_contract.rs) exercises
planner -> parser -> pinned SPL helper, including canonical absence, initialized-empty lists,
short/wrong/trailing groups and destination key/data/prior-extra/amount seeds.

[`tests/integration`](../../tests/integration/main.rs) executes real SBF OFT/composers,
Token-2022 and Endpoint with all manifest variants, normal/redirect selection after planning,
send + PB + fee + Endpoint, missing destination creation and malformed receive-group rollback.
Composer tests use discovery output, not a manually supplied hidden manifest. A dedicated
[`transfer_hook_fixture`](../../tests/programs/transfer_hook_fixture/src/lib.rs) tests native
mechanics only: its manifests are seeded by the harness and it is not an access-control program.

Build fixtures with `pnpm build:test-fixtures`, then run the maintained Rust tests with
`pnpm exec lz-tool --script 'cargo test -p console-oft -p console-oft-integration-tests --locked' anchor`.
These tests are not live-validator/Executor release certification.
