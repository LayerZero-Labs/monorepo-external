# Token manager — Solana

`token_manager` keeps one root (`TokenManagerStore`) per Token-2022 mint. The issuer hands native
authorities to the root's signer PDAs, and the root's RBAC roles decide who may use them: Token ACL
freeze administration, PermissionedBurn approval, the Permanent Delegate, the pause authority, the
mint authority and the transfer-hook authority.
It is also the gating program for
[Token ACL](https://github.com/solana-foundation/token-acl/tree/bfbaf589662631ca84f3462514620a499405c6d7)'s
permissionless freeze/thaw. `pubkey_policy_hook`, an optional Token-2022 transfer hook, is the
sibling [pubkey-policy-hook](../pubkey-policy-hook/README.md) package.

Both programs read blacklist/whitelist answers from the separate pubkey-policy program
(`contracts/common/utils/solana/pubkey-policy`). A policy is any account there for the mint; the ACL
gate and the hook each bind one by writing its address into their manifest. Pubkey policy and native
frozen state are independent: changing a membership or mode never freezes or thaws an account, and
freezing never changes a membership.

## Layout

```
programs/token_manager/       root, RBAC, signer PDAs, Token ACL gate and admin operations
interface/                    token-manager-interface: seeds, root layout, consumer-side ACL helpers
tests/                        host-only Mollusk cross-program suite
fixtures/                     pinned Token ACL and Token-2022 SBF fixtures, shared with consumers
```

Anchor's deployable workspace is `token_manager`. `interface` is a plain library that consumers
link. Program-local handler tests live in `programs/*/tests/`; cross-program scenarios, including
the hook's, belong to `token-app-integration-tests` under `tests/`.

## Build and test

```bash
pnpm resolve-dependencies   # vendor Rust deps into dependencies/
pnpm build                  # anchor build + IDL and TS type generation
pnpm test:rust              # test:unit + test:mollusk
pnpm lint                   # rustfmt --check + clippy -D warnings
```

Every build, test, lint and format command runs through the repo Docker VM tooling
(`lz-tool anchor`); host Cargo is never used.

| Command               | Runs                                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test:unit`           | `cargo test --workspace --exclude token-app-integration-tests` — interface unit tests and `programs/*/tests/`                                    |
| `test:mollusk`        | Builds the manager and both fixtures, copies the hook and pubkey-policy programs from their packages' builds, then `token-app-integration-tests` |
| `test:snapshot:check` | Bytecode integrity against `turbo-snapshot.lock.json`                                                                                            |

`build:check` requires every production artifact, including both fixture binaries, and validates
the manager IDL: the root layout
and discriminator, the supported instruction set and pinned error codes.

`TOKEN_MANAGER_ID` sets the program ID compiled into the binary, IDL and the interface crate;
the default is the development ID `79cu2QNvp92chEmBhBgcUfERDT9KHnUcr8eiJb5WzKML`. `lz-tool` does
not pass host environment variables into its container, so pass it explicitly, and pin one value
across builds, IDLs and clients:

```sh
pnpm exec lz-tool --env TOKEN_MANAGER_ID=<pubkey> --env PUBKEY_POLICY_HOOK_ID=<pubkey> \
  --script 'sh scripts/build.sh' anchor
```

`PUBKEY_POLICY_HOOK_ID` is compiled in too: `set_transfer_hook_policy` signs only into the
pubkey-policy hook at that ID (default `7HTVK1Jwzjd4yRGCZnLT4QmwhmZidurFxwz2RMAiUyzk`). Build with
the ID the hook is deployed at, or every `set_transfer_hook_policy` call fails.

The two fixtures under `fixtures/` re-export pinned upstream entrypoints as standalone workspaces:
upstream Token ACL builds against Token-2022 10 while production pins 11. Nothing is forked. The
Token-2022 fixture exists because Mollusk's bundled binary predates PermissionedBurn. Both are
members of the Anchor workspace, so `pnpm build` compiles them with their own lockfiles and release profiles
into `target/deploy`, where the snapshot pins them and consumers testing against Token ACL
(Console OFT) copy them from.

## State

| Account                   | Seeds                                        | Size               | Owner                |
| ------------------------- | -------------------------------------------- | ------------------ | -------------------- |
| `TokenManagerStore`       | `["token_manager", mint]`                    | 136                | `token_manager`      |
| Signer PDAs               | `["token_manager_signer", root, [kind]]`     | —                  | never allocated      |
| `RoleMember`              | `["RoleMember", root, role, member]`         | —                  | `token_manager`      |
| ACL thaw/freeze manifests | Token ACL's `{thaw,freeze}` meta seed + mint | `size_of(3)` metas | `token_manager`      |
| Hook manifest             | `["extra-account-metas", mint]`              | `size_of(5)` metas | `pubkey_policy_hook` |

`TokenManagerStore` serializes as `mint`, `current_default_admin`, `pending_default_admin`,
`bootstrap`. Every handler binds the root with `has_one = mint`, which is what scopes its roles to
that mint. The root itself never signs.

Signer kinds (`SignerKind`) and the authority each PDA is meant to hold:

| Kind                | Authority                               | Signs in                                                                                   |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Acl`               | Token ACL `MintConfig.freeze_authority` | `freeze/thaw_token_account`, `set_acl_permissions`, `set_acl_gating_program`, `pd_recover` |
| `PermissionedBurn`  | Token-2022 PermissionedBurn authority   | `permissioned_burn`, `pd_burn`                                                             |
| `PermanentDelegate` | Token-2022 Permanent Delegate           | `pd_burn`, `pd_recover`                                                                    |
| `Pause`             | Token-2022 pause authority              | `pause`, `unpause`, `pd_recover` (only when the mint is paused)                            |
| `TransferHook`      | Token-2022 transfer-hook authority      | `set_transfer_hook_policy`                                                                 |
| `Mint`              | Token-2022 mint authority               | `mint_to`                                                                                  |

The `Pause` and `Mint` signers are each either the native authority itself or one member of a
1-of-n native multisig that holds it, passed as `pause_multisig` (`pause`, `unpause`, `pd_recover`)
or `mint_multisig` (`mint_to`). Other members keep signing Token-2022 directly: a Console OFT's
`oft_store` can share the mint multisig and mint on receive. The signer is one vote, so a threshold
above one cannot be met.

`set_native_authority` also signs as whichever kind it moves, directly or through a 1-of-n
`multisig` the signer belongs to (any native kind; Token ACL's config authority is a single key). A
native multisig whose members are all program PDAs, such as `oft_store` plus the `Mint` signer, has
no key that can rotate it natively, so `set_native_authority` is its only way to move.

## Authority model

`init_token_manager` creates the root. Any live holder of these authorities may authorize it: the
freeze authority (when that is Token ACL's MintConfig, the config's `freeze_authority` instead),
the mint authority, the PB authority or the Permanent Delegate. They are trusted alike. A holder
already on this root's signer PDAs cannot sign before the root exists, so another holder must
create it. The authorizing key is stored as `bootstrap`; it may be a plain signer, a PDA signing by
CPI, or a native multisig whose members are the remaining accounts.

`authority` is an unchecked account on `init_token_manager` and `set_pending_token_manager_admin`,
so generated clients mark it as a non-signer. Set its meta by kind: a plain key or a CPI-signing PDA
is passed as a signer; a native multisig is passed as a non-signer, with its member signers appended
as signing remaining accounts. Otherwise authorization fails.

No DefaultAdmin exists until `pending_admin` signs `accept_token_manager_admin`. Until then the
bootstrap may re-point the pending admin with `set_pending_token_manager_admin`. After acceptance
the only governance handoff is RBAC's two-step DefaultAdmin transfer, which moves no native
authority.

Native authorities reach the signer PDAs natively — assigned when the extension is initialized, or
moved by their current holder with Token-2022 or Token ACL `SetAuthority`; the TokenManager never
acquires one itself. DefaultAdmin can move a held authority to another key with
`set_native_authority`, which rejects the null key, the root, the MintConfig and every signer PDA
of this root: none of those could ever move it again. To renounce, move the authority to a key that
nulls it natively. To pause a capability, revoke its roles instead.

### Roles

| Role           | Value | Powers                                                                                                                                                                                                       |
| -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DefaultAdmin` | 0     | Role administration, `init_acl`, `set_acl_permissions`, `set_acl_gating_program`, `set_native_authority`, `set_transfer_hook_policy`, `pd_recover` (EVM `recoverFunds`, with frozen standing in for blocked) |
| `Freezer`      | 1     | `freeze_token_account`                                                                                                                                                                                       |
| `Thawer`       | 2     | `thaw_token_account`                                                                                                                                                                                         |
| `Burner`       | 3     | Approve a `permissioned_burn`                                                                                                                                                                                |
| `PdBurner`     | 4     | `pd_burn` (EVM `burn(from)`)                                                                                                                                                                                 |
| `Pauser`       | 5     | `pause` (EVM `pause`)                                                                                                                                                                                        |
| `Unpauser`     | 6     | `unpause` (EVM `unpause`)                                                                                                                                                                                    |
| `Minter`       | 7     | `mint_to` (EVM `mint`); Token-2022 rejects a frozen destination                                                                                                                                              |

An OFT burning through PermissionedBurn needs only `Burner`, granted to the address it approves
as (Console OFT's `oft_escrow`). `PdBurner` is the all-powerful burner, EVM's `BURNER_ROLE`; an
OFT never needs it.

`pd_recover` is DefaultAdmin's alone, as `recoverFunds` is on EVM: `Freezer` can freeze any funded
account, so a separate recovery role would let two non-admin roles together seize any balance.

On a mint with a live Token-2022 transfer fee, `pd_recover`'s transfer pays it: the destination
receives the amount minus the fee, which stays withheld, and `FundsRecovered` reports the requested
amount.

`pd_recover` and `pd_burn` move only an account's public balance. Token-2022 gives the Permanent
Delegate no authority over confidential balances: moving one requires the account owner and its
zero-knowledge proofs. A `Freezer` can still freeze such an account, which stops every confidential
operation, but its confidential balance cannot be recovered or burned.

`DefaultAdmin` holds no other operational role implicitly — grant them. Grants survive a DefaultAdmin
transfer until revoked, including grants to the old admin. Mint and program-upgrade authorities stay
independently configured; the hook-update authority does too unless it is handed to the root's
`TransferHook` signer.

## Instructions

`token_manager`:

| Instruction                       | Authority                 | Effect                                                                                   |
| --------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| `init_token_manager`              | Native holder (see above) | Create the root with a pending admin. Acquires no token authority.                       |
| `accept_token_manager_admin`      | Pending admin             | Become DefaultAdmin; once per root.                                                      |
| `set_pending_token_manager_admin` | `bootstrap`               | Re-point the pending admin before acceptance.                                            |
| `set_native_authority`            | `DefaultAdmin`            | Move a signer PDA's authority (direct or via a 1-of-n multisig) to another non-null key. |
| `init_acl`                        | `DefaultAdmin`            | Bind a pubkey policy into both ACL gate manifests. Requires DAS `Frozen`.                |
| `set_acl_permissions`             | `DefaultAdmin`            | Set Token ACL's permissionless freeze/thaw flags.                                        |
| `set_acl_gating_program`          | `DefaultAdmin`            | Point Token ACL's config at another gate, such as a successor program's.                 |
| `freeze_token_account`            | `Freezer`                 | Freeze one account through Token ACL, whatever its balance or membership.                |
| `thaw_token_account`              | `Thawer`                  | Thaw one account through Token ACL, whatever its balance or membership.                  |
| `can_thaw_permissionless`         | Token ACL CPI             | Gate callback; SPL discriminator, not an Anchor name.                                    |
| `can_freeze_permissionless`       | Token ACL CPI             | Gate callback.                                                                           |
| `permissioned_burn`               | `Burner`                  | Approve and execute a Token-2022 PermissionedBurn.                                       |
| `pd_burn`                         | `PdBurner`                | Burn from any account as the Permanent Delegate.                                         |
| `pd_recover`                      | `DefaultAdmin`            | Move a frozen account's funds as the Permanent Delegate; it stays frozen.                |
| `pause`                           | `Pauser`                  | Pause the mint as the `Pause` signer; fails if it is already paused.                     |
| `unpause`                         | `Unpauser`                | Resume the mint as the `Pause` signer; fails if it is not paused.                        |
| `mint_to`                         | `Minter`                  | Mint to a token account as the `Mint` signer.                                            |
| `set_transfer_hook_policy`        | `DefaultAdmin`            | Bind or re-bind the pubkey-policy hook's policy as the `TransferHook` signer.            |

As on EVM, `pause` and `unpause` fail with `PauseStateIdempotent` when the mint is already in the
requested state. Setters of a value, pointer or configuration emit on every call, including
`set_acl_permissions`, which sets both flags together as EVM's `setRateLimitGlobalConfig` does.

The `#[rbac::rbac]` macro additionally generates `grant_role`, `revoke_role`, `renounce_role`,
`begin_default_admin_transfer`, `accept_default_admin_transfer` and `get_default_admin`.

`pubkey_policy_hook`: `init_transfer_hook` (mint's hook-update authority, directly or through the
root's `set_transfer_hook_policy`) and `transfer_hook`
(SPL `Execute` discriminator, invoked by Token-2022).

## Enforcement configurations

| Configuration       | Enforced here                                                                                       | Operator still owns                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Policy only         | Nothing; consumers read the policy themselves                                                       | Each consumer must select and enforce the policy; no token program consults it                 |
| Policy + ACL        | Empty-account eligibility for permissionless freeze/thaw; role-gated freeze/thaw of funded accounts | Composing activation for new accounts; `Freezer` must seal funded accounts when policy changes |
| Policy + hook       | Policy on Token-2022 transfers                                                                      | Supplying hook accounts; native holds separately                                               |
| Policy + ACL + hook | Both                                                                                                | Binding both manifests to the intended policy; neither binding updates the other               |

## Token ACL

Program ID `TACLkU6CiCdkQN2MjoyDkVg2yAH9zkxiHDsiztQ52TP`. Ownership and stored authorities are
distinct things:

| Object                                            | Holder                                                                                                  |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Mint and token-account program owner              | Token-2022                                                                                              |
| `MintConfig` program owner                        | Token ACL                                                                                               |
| Mint's native freeze authority                    | Token ACL's `MintConfig` PDA                                                                            |
| `MintConfig.freeze_authority` (logical ACL admin) | The root's `Acl` signer PDA                                                                             |
| Root administration                               | Its RBAC `DefaultAdmin` and separately granted roles                                                    |
| Mint authority                                    | Configured independently; for `mint_to`, the root's `Mint` signer PDA or a 1-of-n multisig including it |
| Hook-update authority                             | The root's `TransferHook` signer PDA, when handed over                                                  |
| Program upgrade authority                         | Deployment governance, outside RBAC                                                                     |

Setup, with the native freeze authority and issuer admin signing their own steps:

1. Initialize a Token-2022 mint with `DefaultAccountState = Frozen` plus the wanted extensions.
2. `init_token_manager`, accept the admin and grant operational roles. Order relative to Token ACL
   does not matter.
3. Token ACL `CreateConfig` with `token_manager` as gating program. This moves native freeze
   authority to the MintConfig and leaves the issuer as logical admin.
4. Token ACL `SetAuthority` to make the root's `Acl` signer PDA the logical admin.
5. DefaultAdmin calls `init_acl` with a pubkey policy for the mint. The policy must already exist,
   since its owner is recorded as the program its records live under. `init_acl` reads no
   MintConfig and can run before the handoff; it rejects a mint whose DAS is not `Frozen`
   (`DefaultAccountStateNotFrozen`) and a policy for another mint (`WrongPolicyMint`).
6. `set_acl_permissions` to enable permissionless freeze and/or thaw. Both start disabled upstream.

Every Token ACL operation signs as the `Acl` signer and relies on Token ACL to reject it unless that
signer is the logical admin. `set_acl_permissions`, `set_acl_gating_program` and
`set_native_authority(Acl)` also pin the mint's `MintConfig` address, because Token ACL's toggle,
gating-program setter and `SetAuthority` never check the mint.
Handlers sign only into instructions they build themselves; there is no generic signed-CPI
forwarding.

Manifests are fixed-size and there is no `resize` or `close`. `init_acl` rewrites both gate
manifests, so DefaultAdmin can rebind the gate to any policy for the mint. The hook's manifest is
rebound by its hook-update authority; once that is the root's `TransferHook` signer, DefaultAdmin
does it through `set_transfer_hook_policy`. A longer recipe needs a program upgrade.

### Permissionless freeze and thaw

```
can_thaw(account)   = allowed(policy, account.owner) AND closable_empty(account)
can_freeze(account) = !allowed(policy, account.owner) AND closable_empty(account)
```

**The permissionless layer only ever moves accounts that hold nothing, in either direction.**
Anything with a balance is a `Freezer`/`Thawer` decision. Emptiness is a proxy for a newly created
account, not a freshness proof — a drained account qualifies too, and that is fine, because there
is nothing to release or to seize. Read the two lines together: the public may open an account at
the frontier, and may re-seal one that was opened before its owner was blocked; it never decides
anything about value.

`closable_empty` fails closed, so its meaning flips between the two. An account the gate cannot
fully parse (native, or an unrecognized extension) is left frozen by `can_thaw` and left _thawed_
by `can_freeze`. Both are deliberate: the gate declines to act on what it cannot reason about, and
the role-gated instructions remain the escape hatch.

Under DAS `Frozen` a new account is born frozen; the client composes creation, Token ACL
permissionless thaw and funding. Call **Token ACL's** permissionless instruction, not the manager's
`can_*` callback: Token ACL authenticates the operation, supplies its transient flag, invokes the
gate and performs the native operation. Gate success alone thaws nothing.

On-chain consumers use the `token_manager_interface::acl` helpers rather than a TokenManager CPI.
They bind their own policy, build a `ValidatedPubkeyPolicy` from it and the subject's record, and
call `ThawAccounts::thaw_if_eligible` in their own program frame. The path is consumer → Token ACL →
the config's gate, then Token ACL → Token-2022. The consumer's policy only decides whether to
attempt the thaw: a disabled flag, a config with no gate, a funded account or a subject it blocks
leaves the account frozen. The helper does not compare the consumer's policy with the gate's manifest. Token ACL
resolves the gate's own extras from its manifest and the gate applies its own policy, so a subject
the gate blocks fails the CPI and the transaction. Keeping the two policies consistent is the
operators' job ([usage](docs/usage.md)).

Emptiness means base amount zero, no native-SOL wrapper, and `closable()` passing on
`TransferFeeAmount`, `ConfidentialTransferAccount` and `ConfidentialTransferFeeAmount`. These are
read-only checks; nothing is closed. Noncanonical zero ciphertexts do not qualify and need
administrative thaw. Other recognized account extensions need no balance check; SPL parsing still
rejects unknown extension IDs and invalid TLV lengths. Bumping Token-2022 means re-auditing
`interface/src/acl/thaw.rs` for newly recognized balance-bearing account extensions.

Membership and mode changes never sweep native state: switching to `Open` thaws nothing, and
blocking a subject freezes nothing until the `Freezer` role acts. The permissionless freeze path
cannot substitute for it; that path only re-seals still-empty accounts thawed before the block
landed.

The same holds when the subject changes rather than the policy. `can_thaw` judges the owner at thaw
time, and Token-2022 lets the owner of a thawed account without `ImmutableOwner` reassign it, to a
blocked key too. Once that account is funded only `Freezer` can seal it, and without the hook it
stays transferable until then. ATAs always carry `ImmutableOwner`, so this concerns auxiliary
accounts only. ACL-only screening therefore trusts allowed owners not to hand accounts on, just as
it trusts them not to hold tokens for someone else.

## Optional transfer hook

A Token-2022 mint has exactly one transfer hook. When that hook is `pubkey_policy_hook`, its
hook-update authority calls `init_transfer_hook` to bind a pubkey policy for the mint into the
mint-scoped manifest; another mint's policy fails with `WrongPolicyMint`. Hand the hook-update
authority to the root's `TransferHook` signer to put binding and rebinding under RBAC: DefaultAdmin
then binds through `set_transfer_hook_policy`, and no native key can switch screening to another
policy. Left with a native key (for example a 1-of-n multisig), any holder can rebind it, including
to an `Open` policy. Binding requires the hook-update authority to still exist and sign — do it
before renouncing that authority. Changing the hook program itself is not a root operation: hand
the authority out with `set_native_authority`, update it natively, and hand it back.
Revoking that authority does not disable the configured hook or stop the policy's admins from
changing memberships and mode.

`Execute` account order: source, mint, destination, authority, manifest, then the five resolved
extras — the `PubkeyPolicy`, the pubkey-policy program ID (a PDA namespace, never invoked), and the
source-owner, destination-owner and authority records.

```
authority == mint's Permanent Delegate:  allowed
otherwise:                               allowed(source.owner) AND allowed(destination.owner)
                                         AND allowed(authority)
```

The Permanent Delegate exemption is what lets `pd_recover` move a blocked owner's funds. Only the
mint's actual Permanent Delegate gets it; ordinary approved delegates do not. The hook writes
nothing, and it requires Token-2022's `transferring` flag on both token accounts, so invoking it
outside a transfer fails with `NotTransferring`.

The authority check covers the pubkey actually executing the transfer — for a native multisig that
is the multisig account, not each member. It deliberately ignores `source.delegate`, which
Token-2022 may clear before invoking the hook once an allowance is exhausted.

The hook cannot intercept mint, burn or `SetAuthority`, and it screens current pubkeys, not
beneficial owners behind custody. Reassigning a mutable auxiliary account's owner changes the policy
subject; `ImmutableOwner` is not required.

## Permanent Delegate operations

`pd_burn` burns from any account as the Permanent Delegate. While the mint has a PB authority,
Token-2022 accepts only a PB-approved burn, so the `PermissionedBurn` signer co-signs as the
approval; `PdBurner` alone authorizes the call.

`pd_recover` moves funds out of a frozen source in one instruction: thaw (Token ACL, `Acl` signer),
resume if paused (`Pause` signer, alone or through `pause_multisig`), `transfer_checked` as the
Permanent Delegate, re-pause, refreeze.
The source must be frozen, and a mint that was paused ends paused. Remaining accounts are the mint's
transfer-hook accounts, if it has a hook.

## PermissionedBurn

Opt in by initializing the Token-2022 extension before mint initialization, assigning its authority
to the root's `PermissionedBurn` signer PDA, and granting `Burner` explicitly.

`permissioned_burn` takes caller, root, PB signer, mint, source token account, source authority,
Token-2022 and the caller's `Burner` record — no payer, System Program or event-CPI pair. Remaining
accounts are native multisig members for the source, if any. The manager rejects the PB signer as
the source authority or one of its multisig members, and every other source signature must already
be present when `invoke_signed` adds the approval signature, so approval never becomes spending
authority.

Approval does not consult pubkey policy. To clear the PB authority forever, `set_native_authority`
hands it to a key that nulls it natively; ordinary burns work afterwards and `SetAuthority` cannot
restore it.

## Errors

Codes are partitioned so a consumer can tell layers apart: RBAC 6000+, TokenManager 7000+, shared
policy 8000–8004 (pubkey-policy program 8005+), hook 9000+, PermissionedBurn 10000+.
`declare_policy_errors!` inlines the shared policy variants into each program's local error enum
because Anchor 1.1.2 does not collect dependency error definitions into an IDL. Use the generated
IDLs.

## Before release

Root creation, authority handoffs and migrating to a successor program are in
[docs/usage.md](docs/usage.md).

Verify deployed program IDs, binaries, upgrade authorities, native authorities, DAS, Token ACL
permission flags and both policy bindings against the intended topology. A pinned Cargo revision is
not proof of what is deployed at a given address. Regenerate IDLs after any ABI change and refresh
client account plans after any manifest change. This package deploys nothing.
