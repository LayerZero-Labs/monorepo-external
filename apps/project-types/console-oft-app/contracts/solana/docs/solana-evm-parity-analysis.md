---
owner: shankar
reviewed: 2026-10-02
---

# Where Solana diverges from the EVM spec

The EVM contracts are the product specification. This records every place the Solana
implementation behaves differently, why, and what an operator or integrator must do about it.

Divergences exist because Solana's account model forces them, not because the Solana build chose
its own semantics. Where a divergence is a deliberate product decision rather than a platform
constraint, it says so.

**Read this if** you are wiring a deployment, writing Console tooling, or carrying an operational
mental model over from an EVM chain. Several things that are automatic on EVM require an explicit
action here.

## The structural difference everything else follows from

On EVM the token is ours: `ERC20Plus` enforces policy directly, gating every movement path.

```solidity
function transferFrom(...) onlyAllowlisted(msg.sender) onlyAllowlisted(_from) onlyAllowlisted(_to)
function transfer(...)     onlyAllowlisted(msg.sender) onlyAllowlisted(_to)
function burn(...)         onlyAllowlisted(_from)
function mint(...)         onlyAllowlisted(_to)
```

On Solana the mint is SPL Token-2022, which we do not author. Policy is enforced by two separate
mechanisms that cover different operations and update on different schedules:

|                                                                    | enforces on             | evaluated                               |
| ------------------------------------------------------------------ | ----------------------- | --------------------------------------- |
| `pubkey_policy_hook` (Token-2022 transfer hook)                    | transfers               | at transfer time, reads the policy live |
| native frozen bit (canonical Token ACL holds the freeze authority) | transfers **and burns** | whenever it was last set                |

Neither covers everything ERC20Plus's four modifiers cover, and the second is state rather than a
live check. That single fact produces most of what follows.

## Divergences

### D1 — Blocking a holder is immediate on EVM, eventually-consistent on Solana

On EVM, writing the blocklist changes enforcement on the next call: `onlyAllowlisted` reads
current state.

On Solana, blacklisting a pubkey updates its `PubkeyPolicy` subject record, and the transfer hook
honours it immediately for **transfers**. But **burn does not run the hook** — `process_burn` only checks
the frozen bit. So a blacklisted holder with an already-thawed account can still burn until
someone freezes it.

**Operator action:** blacklisting is not self-enforcing. A keeper holding the **`Freezer` role**
must freeze the subject's existing token accounts through `token_manager::freeze_token_account`.
Budget for that being a separate, monitored job, not a side effect.

Permissionless freeze cannot do this. It is scoped to accounts that hold nothing
(`Gate::can_freeze`), so it only re-seals accounts opened at the frontier before the block
landed — see [D4](#d4--open-mode-does-not-mean-everyone-can-transact).

### D2 — Policy roles do not imply enforcement

ERC20Plus keeps `BLACKLISTER` and `WHITELISTER` separate, and either one's write takes effect
immediately. The pubkey-policy program splits membership the same way (`Blacklister`,
`Whitelister`), but making a change stick against existing token accounts needs the token
manager's separately granted `Freezer` role.

**Consequence:** granting someone blacklist authority on Solana grants strictly less than the
same grant on EVM. An operator with `Blacklister` alone can express policy they cannot enforce.

### D3 — `PubkeyPolicyMode` is only fully enforceable where a consumer evaluates it dynamically

Switching Blacklist → Whitelist does not reconcile existing token accounts. Accounts thawed under
the old mode stay thawed.

Mode switching gives ERC20Plus-equivalent semantics **only** through the transfer hook, which
re-evaluates on every transfer. ACL and native-freeze configurations encode the blocked/allowed
state at the moment they act, and a later mode change does not revisit it.

**Operator action:** treat a mode change as requiring a reconciliation sweep over existing
accounts, not as a switch.

### D4 — "Open" mode does not mean everyone can transact

`PubkeyPolicyMode::Open` short-circuits the policy axis — membership is never consulted. But the native
frozen bit is a separate axis, and an administrative freeze is unaffected by mode.

The two directions are asymmetric in Open mode:

- permissionless **freeze** is impossible (it requires the subject to be blocked, and Open blocks
  nobody)
- permissionless **thaw** is available to anyone, for any empty account

So in Open mode an administrative freeze of an _empty_ account is reversible by any member of the
public in the next slot. It is durable only against a funded balance.

That is the design rather than a gap, once the split is stated: **the permissionless ACL layer
owns the new-account frontier and only ever moves accounts holding nothing, in either direction.
Anything with a balance is a `Freezer`/`Thawer` decision.** An empty account is worth nothing to
hold, which is why the public may open or re-seal one; value is never the public's call. If a
discretionary hold on an empty account has to stick, the lever is the policy, not an administrative
freeze: switch it to Blacklist mode and set the subject's `blacklisted` flag, which makes
permissionless thaw refuse. Open mode ignores the flag. In Blacklist mode a subject without a record
stays allowed, so the switch affects only subjects explicitly blacklisted.

### D5 — The OFT's own PDAs are policy subjects

The transfer hook screens source owner, destination owner and transfer authority. In OFT flows
the escrow's owner and the transfer authority are both `oft_store`, so the OFT's own identity
becomes a policy subject.

In Whitelist mode this means **`oft_store` must be whitelisted or the OFT is offline in both
directions**. EVM has no equivalent requirement: `ERC20Plus.mint(to)` / `burn(from)` check the user, never the
minter.

**Operator action:** whitelisting `oft_store` is a mandatory wiring step before Whitelist mode can
be enabled. Assert it in the deployment script; do not rely on noticing.

### D6 — Mint and burn have a different enforcement surface

ERC20Plus applies `onlyAllowlisted` to `mint(_to)` and `burn(_from)` directly. Solana has no
equivalent hook on either operation; both are gated only by the frozen bit.

The practical effect is close but not identical: minting to a frozen account fails, and burning
from a frozen account fails, so a _frozen_ blocked user is covered. A blocked user whose account
has not yet been frozen is not — see D1.

### D7 — Credit redirect triggers on account state, not only on policy

EVM's `_redirectCredit` keys purely on `isAllowlisted(_to)` and never reverts; the escrow is
guaranteed non-zero by a write-time invariant.

Solana must also handle a destination that cannot receive at all. Current behaviour:

| recipient state                                                                 | Solana                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| policy-blocked, escrow configured                                               | redirect to escrow — matches EVM                     |
| policy-blocked, no escrow configured                                            | **error** `CreditBlocked`, delivery held — see below |
| frozen, correctly bound ACL enabled, policy-allowed and empty                   | thaw inline, then normal delivery                    |
| frozen, not thawable: funded, no policy, thaw off, no gate, or not on Token ACL | redirect to escrow, or `CreditBlocked` without one   |

The frozen rows describe the account as `lz_receive` finds it, not a durable hold. Token-2022 lets
an owner close an empty frozen account, and `lz_receive` re-creates the ATA unfrozen, unless the
mint's DefaultAccountState is Frozen, and even then thaws it inline when permissionless thaw admits
the recipient. So a freeze on an empty ATA does not keep its credits redirected; only a funded
frozen ATA cannot be closed. The pubkey policy is the hold, as `isAllowlisted` is on EVM.

**An all-zero recipient reports differently.** Most ERC-20s refuse `address(0)`, so EVM's `_credit`
mints or transfers to `0xdead` instead and reports 0, since the credit did not land at `_to`. On
Solana `bytes32(0)` is `Pubkey::default()`, the zero address, which is also the System Program's ID.
Token-2022 and SPL Token accept it as an owner, so no remap is needed: `lz_receive` creates and
credits its ATA at the address the sender named and reports the full amount in `OFTReceived` and
the compose message. Nobody can sign for it, so the tokens are unrecoverable on both chains; only
the reported amount differs.

Required ACL accounts cannot be omitted to force fallback. Their presence follows the mint's native
authority and OFT's stored policy selection; missing/malformed inputs error and preserve the payload.

**Policy without an escrow is a supported configuration, and EVM has no equivalent.** The two are
set by independent instructions; EVM forbids policy-without-escrow at write time because it treats
a non-zero escrow as an invariant. Solana allows it deliberately — an issuer may prefer that a
blocked delivery simply fail over taking custody of funds it must later sweep.

In that configuration a blocked recipient gets `CreditBlocked` (`LzReceive::apply`), raised
_before_ `clear_payload`, so the message is left unconsumed rather than lost: setting an escrow, or
unblocking the subject and thawing its funded ATA with a `Thawer` (permissionless thaw only handles
empty accounts; see the TokenManager usage doc), later makes a replay succeed. The Executor stops after `maximumAttempts`,
so the delivery stays pending until an operator acts.

**Operator action:** decide which posture you want before going live. Choosing no escrow is a
choice to hold deliveries, not a misconfiguration — but nothing in the program tells you which one
you picked.

### D8 — Delivery owns ATA activation that EVM has no concept of

Under canonical ACL every new token account is created frozen, so a first-time recipient's ATA
cannot receive until it is thawed. `lz_receive` creates it and calls the shared interface's native
ACL helper inline, then reloads it before credit routing.

This has no EVM analogue — there is no account to create and no frozen state to lift. It means a
Solana delivery is **one `lz_receive` instruction** that atomically includes creation, eligible
thaw and credit.

### D9 — Permanent Delegate recovery keys on frozen, not blocked

`ERC20Plus.recoverFunds` requires only that the source is non-allowlisted, then bypasses the
allowlist and pause modifiers entirely.

`token_manager::pd_recover` (`DefaultAdmin`, as `recoverFunds`) keys on native state instead: the source must be
frozen. It thaws, transfers as the Permanent Delegate and refreezes in one instruction, resuming
and re-pausing a paused mint around the transfer. The pubkey-policy hook exempts the Permanent
Delegate entirely, so neither side's policy is checked — matching `recoverFunds`. The divergence is
the trigger: a blocked holder whose account is not yet frozen cannot be recovered until a `Freezer`
freezes it.

On a mint with a live Token-2022 transfer fee, the recovered transfer pays it: the destination
receives the amount minus the fee, which stays withheld, while `FundsRecovered` reports the
requested amount. `recoverFunds` moves the exact amount.

Recovery and `pd_burn` reach only an account's public balance. On a mint with confidential
transfers, a holder can `Deposit` into its confidential balance until the account is frozen, and
the Permanent Delegate has no authority there: every instruction that moves a confidential balance
requires the account owner and the owner's zero-knowledge proofs. Freezing still holds those funds
(every confidential operation refuses a frozen account), but no issuer role can move or burn them,
so they stay in the frozen account and in supply. `recoverFunds` has no equivalent gap. Issuers who
need full recovery should not enable confidential transfers, or should set
`auto_approve_new_accounts = false` and approve only accounts they trust.

### D10 — Rate-limit configuration must exist before a pathway works

EVM stores rate limits in a mapping, so an unconfigured EID reads as zero-valued and permits
traffic. Solana requires the per-EID PDA to exist; absent it, both send and receive fail with
`RateLimitNotInitialized`, and `quoteOFT` throws where EVM returns a number.

**Operator action:** initialising the rate limit for every destination EID, including the default
id, is a deployment prerequisite rather than an optimisation.

### D12 — One policy per mint is an operator convention, not checked

The ACL gate, the pubkey-policy hook and the OFT each bind a `PubkeyPolicy` through their own
instruction, and policies are keyed by `(mint, initializer)`, so several can exist for one mint.
Nothing compares the three bindings: the OFT's selection predicts the others. Each changes under its
own authority.

A mismatch shows up on receive. If the OFT's policy blocks a recipient, the credit is redirected or
refused. If the OFT's policy allows a recipient that the gate or the hook blocks, the inline thaw or
the credit transfer fails and the delivery reverts; the payload stays uncleared and delivers on retry
once the bindings agree. Ordinary SPL transfers are screened only by the hook's policy.

**Operator action:** keep the three bindings on the same policy, and change them together
([usage](usage.md)).

## Matches — no divergence

Confirmed field-for-field against the Extended EVM variant. Listed so nobody re-derives them:

- `_debitView` shape: `amountSentLD = amountLD` (not de-dusted), `amountReceivedLD =
removeDust(amountLD - fee)`, slippage check against `minAmountLD`
- dust placement: the `amountSent - amountReceived` delta is fee **plus dust** and goes to the fee
  deposit on both sides
- return-zero-on-redirect: a redirected credit reports `0`, in both the `OFTReceived` event and
  the amount handed to compose, so neither can be read as proof of payment
- the rate-limiter token bucket, branch for branch
- fee arithmetic, bounded by a 10 000 bps cap at every write site
- pause semantics, including the Pauser/Unpauser split
- `OFTSent` / `OFTReceived` / `CreditRedirected` field shape and emission points

## Where to look

|                        |                                                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| EVM policy enforcement | `contracts/evm/contracts/ERC20Plus.sol`                                                              |
| EVM OFT core (fees)    | `@layerzerolabs/oft-upgradeable-evm-contracts/contracts/extended/OFTCoreExtendedRBACUpgradeable.sol` |
| Solana pubkey policy   | `contracts/common/utils/solana/pubkey-policy/`                                                       |
| Solana token manager   | `apps/token-app/contracts/solana/token-manager/programs/token_manager/`                              |
| Solana transfer hook   | `apps/token-app/contracts/solana/pubkey-policy-hook/programs/pubkey_policy_hook/`                    |
| Solana OFT             | `programs/console_oft/src/instructions/{send,lz_receive}.rs`                                         |
| Resource limits        | [`resource-budget.md`](./technical/resource-budget.md)                                               |
