---
owner: shankar
reviewed: 2026-09-25
---

# Operating the TokenManager

What the TokenManager leaves to the mint's authorities and the root's admins. Setup steps for Token
ACL are in the [README](../README.md#token-acl); OFT-side duties are in the
[Console OFT usage doc](../../../../../project-types/console-oft-app/contracts/solana/docs/usage.md).

## Creating the root

- Any live native authority of the mint can create its one root: the freeze admin (Token ACL's
  logical admin when the MintConfig holds freeze), the mint authority, the PB authority or the
  Permanent Delegate. They are trusted alike; a holder that disagrees with the root can use
  another TokenManager program.
- The creator names a pending DefaultAdmin, who must accept. Until then the creator can re-point
  it, for example to fix a typo.
- An authority already moved onto this root's signer PDAs cannot sign before the root exists, so
  some other live authority must create it. A mint whose every authority sits on unsignable PDAs
  can never get a root.

## Native authorities

- `set_native_authority` rejects null, the root itself, the MintConfig and this root's own signers,
  but it cannot tell whether a target can sign. Never hand an authority to another mint's root or
  to an unrelated PDA; it cannot come back.
- Token ACL's own `SetAuthority` accepts any key. A null logical admin strands funded frozen
  accounts, since the permissionless gate only handles empty ones.
- Do not renounce the transfer-hook authority while a hook is selected: afterwards neither the hook
  program nor its manifest's policy binding can change.

## Token ACL and the hook

- Create the pubkey policy before `init_acl` or `init_transfer_hook` binds it: its owner is
  recorded as the program its records live under, so binding fails for a policy that does not
  exist yet.
- `init_acl` and `init_transfer_hook` can run before the config or mint names this program; the
  manifests are inert until it does. Keep the gate's, hook's and OFT's policy choices consistent;
  the programs do not check each other.
- `set_acl_gating_program` points the config at another gate, such as a successor program's.
- A Freezer hold on an empty account does not last: permissionless thaw, or an OFT's inline thaw,
  undoes it whenever the policy allows the owner. Use the policy (Blacklist) for a durable hold;
  Freezer and Thawer are for funded accounts.
- **Blocking a holder takes freezing too.** A block only stops new accounts being thawed; the
  holder keeps their thawed ones. Without the hook they can transfer from them until frozen. With
  it, transfers are refused, but `SetAuthority(AccountOwner)` never runs the hook, so the owner of a
  non-ATA account (no `ImmutableOwner`) can hand it, balance included, to an allowed key; ATAs and
  frozen accounts cannot be reassigned. So freeze the holder's funded accounts in the same
  transaction or bundle as the block: all of them without the hook, the non-ATA ones with it (find
  them by owner with `getProgramAccounts`). The gate does not require `ImmutableOwner`, because
  every program-owned token account would then need a Thawer.
- **Confidential-transfer mints.** A blocked holder can still `Deposit` into its confidential
  balance until its account is frozen, and `pd_recover` and `pd_burn` cannot reach that balance
  afterwards. Freeze in the same transaction as the block, as above. For full recovery, do not
  enable confidential transfers, or set `auto_approve_new_accounts = false` and approve only
  trusted accounts.
- **Unblocking a holder takes thawing too.** Permissionless thaw only handles empty accounts, so
  funded accounts frozen with a block stay frozen after it is lifted, and `pd_recover` can still
  move their funds. Thaw them with a `Thawer` when unblocking.

## Migrating to a successor TokenManager program

1. **Create the successor root.** A live authority that is not on the old root's PDAs signs. If
   every authority is on the old root, first move one to a signing key with
   `set_native_authority`.
2. **Configure the successor.** Its DefaultAdmin accepts, grants roles, and writes its manifests
   with `init_acl`.
3. **Hand over to the successor's signer PDAs.** The old root signs only as its own signer PDAs, so
   it moves just the authorities it still holds: `set_acl_gating_program(successor program)` while
   it holds Acl, then `set_native_authority` for each of Acl, PermissionedBurn, PermanentDelegate,
   Pause, Mint and TransferHook. The key from step 1 moves its authority itself: Token-2022
   `SetAuthority`, or for Acl, Token ACL `SetGatingProgram` then `SetAuthority`.
4. **Update consumers.** For the OFT: `set_token_manager(new root)`, the Burner grant to
   `oft_escrow` on the new root, and `sync_acl_gating_program`.
