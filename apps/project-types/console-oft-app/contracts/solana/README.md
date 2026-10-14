# Console OFT — Solana

`console_oft` is the Solana implementation of the Console OFT: a LayerZero OFT with per-destination
fees, pause, rate limiting, inbound credit redirection and optional recipient pubkey-policy admission. One
deployed program ID hosts many independent `OFTStore` instances, each with its own roles, peers,
fees, pause and rate-limit state.

Custody is a field, not a contract choice: `OFTStore.oft_type` selects `LockUnlock` or `BurnMint`.
Both route through an escrow PDA so a Token-2022 transfer hook fires on the way in and out — the
hook does not run on `mint_to` or `burn`, so a pure mint-and-burn path would enforce nothing.

## Build and test

```bash
pnpm test        # test:rust + test:sdk + test:validator
pnpm lint        # rustfmt --check, clippy, eslint
```

Rust builds and tests run through the repo Docker VM tooling (`lz-tool anchor`); host Cargo is
never used. `pnpm build` and `pnpm build:sdk` exist for artifact-only runs.

| Command               | Runs                                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `test:rust`           | `build-test-fixtures`, then `console-oft` and `console-oft-integration-tests` under Mollusk                      |
| `test:policy`         | Focused: `oft_pubkey_policy` plus the cross-program `integration` suite                                          |
| `test:sdk`            | Builds IDLs + Codama SDK, runs `tests/sdk/*.test.ts` (plan decoding, V1 wire encoding, pubkey-policy resolution) |
| `test:validator`      | `tests/*.test.ts` against a local validator                                                                      |
| `test:snapshot:check` | Bytecode integrity against `turbo-snapshot.lock.json`                                                            |

`scripts/build-test-fixtures.sh` gathers the SBF programs the suites execute. It compiles
`console_oft`, two test composers and a test-only hook exercising absent/empty manifests and
destination seeds. `token_manager`, `pubkey_policy_hook` and `pubkey_policy` come from their own
packages' builds, and the pinned canonical Token ACL and Token-2022 11 from token-manager's; none
are rebuilt here.
See [tests/integration/README.md](tests/integration/README.md) for what the cross-program suite
does and does not prove.

## Program structure

The module carries one attribute, `#[oft::oft(state = OFTStore, role_type = RoleType)]`, which
generates the standard OFT and OApp instruction surface: peers, enforced options, `next_nonce`,
`is_compose_msg_sender`, the messaging-channel wrappers, the `lz_receive*` family, the OFT views and
`send`/`quote_*`. Two attributes let the module supply its own handler instead:

| Attribute             | Purpose                                   |
| --------------------- | ----------------------------------------- |
| `#[oft_instruction]`  | Override or provide an OFT-layer handler  |
| `#[oapp_instruction]` | Override or provide an OApp-layer handler |

Instructions with no override get the macro's default. Instructions with no sensible default are
compile errors when omitted. `console_oft` overrides `send`, `quote_oft`, `quote_send`, the three
OFT views, `lz_receive`, `lz_receive_types_info` and `lz_receive_types_v3`.

Everything Console-specific — fee config, fee handler, pause-by-ID, rate limiting, credit redirect,
pubkey policy, hook-cache sync and the two bootstrap instructions — is a plain `pub fn` on the
module. `#[rbac::rbac]` adds `grant_role`, `revoke_role`, `renounce_role`,
`begin_default_admin_transfer`, `accept_default_admin_transfer` and `get_default_admin`.

## State

| Account                     | Seeds                                               | Notes                                                                                        |
| --------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `OFTStore`                  | `["OFT", initializer]`                              | One per deployment. The initializer signs `init_console_oft` once and is never needed again. |
| escrow                      | `["Escrow", oft_store]`                             | Token account owned by `OFTStore`; the hop every transfer goes through.                      |
| `RateLimit`                 | `["RateLimit", oft_store, id_be_u128]`              | `id = 0` is the default config and global state.                                             |
| `RateLimitAddressExemption` | `["RateLimitExemption", oft_store, user]`           | Existence means exempt.                                                                      |
| `PauseConfig`               | `["Pause", oft_store, id_be_u128]`                  | Per-destination override.                                                                    |
| `FeeConfig`                 | `["Fee", oft_store, id_be_u128]`                    | Per-destination override.                                                                    |
| `EnforcedOptions`           | `["EnforcedOptions", oft_store, dst_eid, msg_type]` | `msg_type` 1 = Send, 2 = SendAndCall.                                                        |
| `RoleMember`                | `["RoleMember", oft_store, role, member]`           | Existence means the member holds the role.                                                   |
| `OAppInfo`                  | `["OAppInfo"]`                                      | Program-level, not per store.                                                                |

Immutable on `OFTStore`: `oft_type`, `ld2sd_rate`, `shared_decimals`, `token_mint`, `initializer`,
`token_program`, `bump`. Mutable: `transfer_hook_program` and `acl_gating_program` (caches), the two
admin fields, `default_paused`, `default_fee_bps`, `fee_deposit`, `use_global_state`,
`is_globally_disabled`, `credit_redirect_config`, `pubkey_policy` and `token_manager`.

### Roles

| Role                      | Value | Gates                                                                                                                                             |
| ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DefaultAdmin`            | 0     | Role administration, peers, enforced options, delegate, `set_fee_deposit`, `set_credit_redirect_config`, `set_pubkey_policy`, `set_token_manager` |
| `FeeConfigManager`        | 1     | `set_default_fee_bps`, `set_fee_bps`                                                                                                              |
| `Pauser`                  | 2     | Pausing                                                                                                                                           |
| `Unpauser`                | 3     | Unpausing                                                                                                                                         |
| `RateLimiterManager`      | 4     | Rate-limit config, state and exemptions                                                                                                           |
| `MessagingChannelManager` | 5     | `clear`, `skip`, `burn`                                                                                                                           |
| `MessageNilifier`         | 6     | `nilify`                                                                                                                                          |

Admin handoff is two-step: the current admin nominates, the nominee accepts. The OApp layer always
supplies `accept_default_admin_transfer` — it cannot be overridden — so the Endpoint delegate is
synced to the new admin in the same instruction. The messaging-channel wrappers never take an
Endpoint receiver from the caller; each injects and signs as the `OFTStore` PDA. The two
messaging-channel roles let other keys clear, skip, burn or nilify through the OFT; the DefaultAdmin,
as the OApp's Endpoint delegate, can already call those on the Endpoint directly.

## Configuration surfaces

| Surface      | Shape                                                                   |
| ------------ | ----------------------------------------------------------------------- |
| Fee          | Global default bps on `OFTStore` + per-destination `FeeConfig` override |
| Fee handler  | One admin-settable `fee_deposit` token account                          |
| Pause        | Default flag on `OFTStore` + per-ID `PauseConfig` override              |
| Rate limiter | Default `RateLimit` (id 0) + per-ID configs + per-address exemptions    |

A per-ID `RateLimit` falls back to the default config unless its `override_default_config` is set.
State is a separate axis: with `use_global_state` disabled, usage lives in the per-ID PDA even when
that ID uses the default configuration.

**Initialize the rate-limit account whenever you add or wire a peer.** Adding a peer does not create
it. Without it, `quote_oft` and `get_rate_limit_usages` return `RateLimitNotInitialized`, and `send`
and `lz_receive` do the same whenever they would touch state. An address-exempt send can still
succeed, because `quote_oft` is user-agnostic and does not reflect exemptions.

## Send

`send` runs pause → debit → `_lzSend` → `OFTSent`. It does not consult the OFT's selected pubkey
policy. Sender restrictions are enforced by the native source → escrow transfer: frozen accounts
fail, and any configured transfer hook runs, including before a BurnMint burn. A blocked pubkey
with an unfrozen source and no rejecting hook can send directly; receive screening is not an
outbound identity restriction. Non-ATA source accounts are supported.

`Send` has 20 fixed accounts, including the two `#[event_cpi]` accounts. The four `burn_*`
accounts are needed only while the mint's PermissionedBurn is active; hook-resolved accounts travel
in `remaining_accounts`.

Debit is `debit_view` (fee split, slippage check) → `outflow` (rate limit, with exemption) →
transfer sender → escrow (hook fires) → burn from escrow for `BurnMint` → sweep the fee to
`fee_deposit`. `remaining_accounts` is `[source hook group][fee hook group][Endpoint send]`, with
the fee group present only when something is collected: the bps fee plus decimal dust, so a 0 bps
send of an amount that is not a multiple of the shared-decimal rate collects its dust too. Each hook
group's length is read from the mint and its manifest, not asserted by the caller.

Initialization and `set_fee_deposit` reject a currently frozen deposit with `FeeDepositFrozen`.
The freeze authority can still freeze it later: a send that collects a fee or dust then fails
atomically at the native transfer, while a send that collects nothing never uses the deposit and can
omit its account.

Each configured hook uses `[hook program, canonical manifest witness, resolved extras…]`, even
when its manifest is unallocated. The shared checked group consumes that witness but omits it
from the native CPI when absent. See [transfer-hook contract](docs/technical/transfer-hook-contract.md)
for framing, destination seeds and supported boundaries.

Escrow burn picks its path from live mint state, not from which optional accounts the caller
supplied. When the mint's `PermissionedBurnConfig` names an approver, `send` approves `oft_escrow`
as its own delegate for exactly the amount and CPIs the accepted root's (`set_token_manager`)
`permissioned_burn` with only the escrow's signature, never `OFTStore`'s; the escrow holds the
root's `Burner` role, and the mint supply must drop by the amount. Token-2022 requires the approver
to be the mint's PB authority, the root's PB signer. Otherwise it burns through the token program
directly.

Both custody paths assume lossless transfers. **Nonzero Token-2022 transfer fees are unsupported**:
debit and credit do not reconcile net balance change, so `send` and `lz_receive` fail with
`TransferFeeActive` while the mint's current-epoch fee is non-zero. A TransferFee extension at
0 bps is fine. Unlike EVM, receives are refused too, and stay retryable while the fee is live. A
fee change takes effect two epochs after it is set, so setting a fee back to zero leaves receives
blocked for roughly two to four days, and a fee left live after renouncing the fee authority blocks
them for good. Such payloads are already verified, so dispose of them with `burn` or `clear` (the
messaging-channel manager's wrappers), or park them with `nilify` until they are re-verified.
`skip` does not apply: it only takes the next unverified nonce, for example to close a gap below a
verified payload. LayerZero protocol fees are separate and fully supported.

## Receive

Solana needs every account declared up front, so delivery is planned before it is executed:

- `lz_receive_types_info` — returns the protocol version and the minimal account set needed to call
  the planner. It reads the cached `transfer_hook_program`, substituting the program ID as Anchor's
  `None` sentinel when no hook is set.
- `lz_receive_types_v3` — run in simulation; writes the whole execution plan into a scratch account
  the caller creates and signs for, and returns the plan's byte length. Sizing that account is the
  caller's job; see [`resource-budget.md`](./docs/technical/resource-budget.md).

The plan format supports a list of instructions; OFT emits exactly one `lz_receive`. Anchor creates
a missing recipient ATA inside that instruction. When a pubkey policy is selected _and_ canonical
Token ACL holds the mint's freeze authority, `token_manager_interface::acl::requires_acl` makes the
native ACL account bundle mandatory in both the plan and `lz_receive`. The shared Rust helper thaws
an eligible frozen ATA inline; OFT reloads it before choosing the credit route. See
[ACL activation](./docs/technical/acl-activation.md) for the boundaries and regression evidence.

`lz_receive` then clears the payload, applies the inbound rate limit, credits, and optionally
forwards a compose message. `remaining_accounts` is `[clear][gate][hook groups][compose groups]` (see
[`receive_accounts.rs`](programs/console_oft/src/helpers/receive_accounts.rs)). With redirect
enabled the plan carries **two** hook groups and two compose groups — recipient and redirect —
because the route is chosen from live state at execution, not from the planning snapshot.

### Hook account planning

`console_oft` mirrors the SPL Transfer Hook `Execute` index layout when resolving extras:

```
0  source token account
1  mint
2  destination token account
3  authority
4  ExtraAccountMetaList
5+ resolved extra accounts
```

The hook program account leads each hook group but is not part of that seed index space.
`TransferHookAccounts` requires the canonical manifest PDA right after it whenever the mint has a
hook; only an unallocated account there reads as the no-extras case, so a caller cannot strip a
hook's policy accounts by omitting the manifest.

Supported during planning:

- `Seed::AccountData` from indices 0–4 for accounts that already exist.
- `Seed::AccountData` inside the synthesized 64-byte mint-and-owner prefix of a recipient ATA that
  does not exist yet.
- Chained `Seed::AccountKey` on already-resolved extras.

Not supported: `AccountData` past that 64-byte prefix, and `AccountData` from a newly resolved
extra — a program cannot read arbitrary account data from a pubkey alone. Only the recipient's own
ATA may be planned before it exists; a redirect escrow is configured ahead of time and must already
hold real data. Because the redirect hook group is planned for every message, closing the escrow
stops planning for all receives on a hooked mint, not only redirects, until
`set_credit_redirect_config` re-points or disables redirect.

First-time ATAs are created during `lz_receive` with the Executor as transaction payer. Enforced
options plus per-send extra options must carry enough `lzReceive` value to cover that rent.

`sync_transfer_hook_program` is permissionless: it refreshes `OFTStore.transfer_hook_program` from
the mint's extension after the mint admin updates it. Execution validates the live mint, so a stale
cache cannot bypass a hook — but it does break discovery. Refresh it and replan after any hook
change.

## Credit admission and redirect

`set_pubkey_policy` (DefaultAdmin) selects one `PubkeyPolicy` for this OFT's mint, or clears the
selection. It is not checked against the policy the ACL gate's or the transfer hook's manifest
binds; see the end of this section for what a mismatch does. Receive screens the message recipient. With a policy selected, both the policy
and the recipient's subject record must be supplied at their canonical addresses, even when the
record does not exist yet; only a cleared selection uses `None` slots. `lz_receive_types_v3`
plans them from the policy stored in `OFTStore`, never from another initializer's policy for the
same mint.

`set_credit_redirect_config` (DefaultAdmin) enables, replaces or disables redirection atomically.
The redirect account must be for the OFT mint, differ from the OFT escrow, and be unfrozen when
configured.

On receive, after Anchor has created any missing recipient ATA, `lz_receive` validates policy,
attempts eligible native activation, then checks the destination's live state:

| Recipient state                                                     | Outcome                                                        |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| Allowed, not frozen                                                 | Normal delivery                                                |
| Frozen, correctly bound ACL enabled, policy-allowed, empty balances | Inline thaw, reload, normal delivery                           |
| Blocked, or frozen and ineligible for activation, redirect enabled  | Credit goes to the redirect escrow, `CreditRedirected` emitted |
| Blocked, or frozen and ineligible for activation, redirect disabled | `CreditBlocked`                                                |
| Required ACL inputs omitted/malformed, or native thaw CPI fails     | Error; whole delivery rolls back                               |

Omitting ACL accounts cannot force redirect: required presence follows the live mint and stored
policy, not the caller's optional inputs. Disabled permissionless thaw is genuine ineligibility and
keeps the configured fallback. The OFT's policy is not required to match the gate's or the hook's:
it predicts them. Inline thaw is attempted when the OFT's policy allows the recipient, and the gate
resolves its own accounts from its manifest. If the gate or the mint's transfer hook refuses a
recipient the OFT's policy allows, the receive reverts rather than redirecting; the payload stays
uncleared and delivers on retry once their configuration admits the recipient. Keeping them
consistent is the admins' job ([docs/usage.md](docs/usage.md)).

Redirected tokens move in full, but `OFTReceived` and the compose message report
`amount_received_ld = 0`.

Native mint, burn and `SetAuthority` are governed by the mint's own authorities. Pubkey policy
applies to OFT send and receive, not to every token operation on the mint.

## On-chain metadata

Solana SDKs need account layouts before they can build a transaction, so the program keeps an
`OAppInfo` PDA that a client reads once. `console_oft` writes three TLV entries into it:

| Entry            | Carries                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `OAppBase`       | Framework schema/IDL version and the app-entry discriminator       |
| `OftInfo`        | OFT-family schema version and the project-entry discriminator      |
| `ConsoleOftInfo` | Console OFT project schema version and IDL version (currently 2.0) |

They chain by discriminator pointer — `OAppBase.app_discriminator → OftInfo`,
`OftInfo.project_discriminator → ConsoleOftInfo` — so one account read decodes the whole stack.
`init_console_oft_info` allocates and writes all three.

## Error codes

Linked first-party error domains have disjoint ranges: RBAC `6000+`, token-manager ACL `7000+`,
pubkey policy `8000+`, hook `9000+`, permissioned burn `10000+`, OApp `11000+` and Console OFT
`13000+`. Each domain reserves 1,000 codes. Anchor framework and downstream CPI errors retain their
native codes; use the failing program to interpret CPI errors. Anchor's OFT IDL lists only the local
OFT enum, so linked dependency errors do not appear in generated SDK decoders.

## Deployment notes

Setup order, operator duties, unsupported token configurations and migrations are in
[docs/usage.md](docs/usage.md).

v2 is a new program with breaking changes to match the v2 spec, not an upgrade of v1: `OFTStore`'s
layout changed (fields replaced and appended, no version field), so a v1 store would misdecode under
an in-place upgrade.

One program ID serves every `OFTStore` under it, so its upgrade authority can change behavior for
all of them at once. Treat it as a trust dependency: control it with the intended governance or
multisig, deploy a separate program ID for isolation, or remove it once the program should be
immutable.

Transaction transport is Solana Kit Transaction V1 with explicit resource budgets and a 256 KiB
heap; the planner returns raw addresses through simulated account data and the program owns no
address lookup tables. Kit validates V1 limits — a larger plan does not make a larger delivery
transaction admissible. Production Executor submission is out of scope for this package.

See the [send/receive resource profile](docs/technical/send-receive-profile.md) for measured SBF
CU, CPI depth, accounts and compiled V1 bytes, including the limits of those measurements.

## References

- [IOFT parity analysis](../../../../oft-app/contracts/solana/oft/solana-evm-parity-analysis.md)
- [Console OFT Extended parity analysis](./docs/solana-evm-parity-analysis.md) — fee config, fee
  handler, pause, rate limiter, credit redirect, messaging channel
- [`oft-info.md`](../../../../oft-app/contracts/solana/oft/docs/oft-info.md),
  [`console-oft-info.md`](./docs/console-oft-info.md),
  [`oapp-info.md`](../../../oapp-app/contracts/solana/docs/oapp-info.md) — on-chain metadata
- [`lz-receive-types.md`](../../../oapp-app/contracts/solana/docs/lz-receive-types.md) — the
  account-discovery protocol
- [`resource-budget.md`](./docs/technical/resource-budget.md) — compute and transaction budgets
- [OApp Standard README](../../../oapp-app/contracts/solana/README.md)
- EVM sources: [`../evm/contracts/`](../evm/contracts/)
