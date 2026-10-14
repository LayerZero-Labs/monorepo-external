---
owner: shankar
reviewed: 2026-10-02
---

# Operating a Console OFT

What the program leaves to its admins and operators: setup order, standing duties, token
configurations it does not support, and migrations. The program enforces its own invariants; these
are the ones it deliberately cannot see, because they live in other programs (Token-2022, Token
ACL, the TokenManager, a pubkey policy) or off-chain. TokenManager-side duties are in the
[token-app usage doc](../../../../../token-app/contracts/solana/token-manager/docs/usage.md).

## Setup order

1. **Mint authority (BurnMint).** Make `oft_store`, or a 1-of-n native multisig that includes it
   (for example together with a TokenManager root's `Mint` signer, so `Minter`s can mint too), the
   mint authority before configuring peers. `init_console_oft` does not check it. Until then
   receives fail and payloads stay retryable; if the mint authority is renounced, BurnMint receives
   can never mint.
2. **`init_console_oft`.** The DefaultAdmin is installed directly, without acceptance, so check the
   key; a wrong one means deploying a new `OFTStore`. The fee deposit must exist, be unfrozen, and not
   be owned by `oft_store`.
3. **Thaw the program's token accounts (DefaultAccountState = Frozen).** `oft_escrow` is created at
   init and starts frozen like any new account; thaw it before traffic (a Thawer, or permissionless
   thaw while it is empty). The fee deposit and redirect escrow must be unfrozen when configured.
4. **Rate limits.** The default limiter starts enabled with zero capacity in both directions, so
   configure it (or disable it) before traffic. As on EVM, set each limit significantly larger than
   its window (in seconds): decay is `limit * elapsed / window` rounded down, and every send,
   receive or checkpoint restarts `elapsed`, so a limit near or below its window can stop decaying
   under frequent traffic.
5. **PermissionedBurn mints.** Before the mint's PB authority moves onto a TokenManager root, call
   `set_token_manager(root)` and have that root grant its Burner role to **`oft_escrow`** (not
   `oft_store`): the manager is only ever given the escrow's signature, approved for the send's
   amount. Otherwise every BurnMint send fails.
6. **Token ACL mints.** After the Token ACL config is created, and after any gate change, anyone
   calls `sync_acl_gating_program`. After any transfer-hook change, anyone calls
   `sync_transfer_hook_program`. Planning fails until then (`InvalidAclThawMetas`, or missing hook
   accounts); payloads stay retryable. Both emit an event.
7. **Pubkey policy.** `set_pubkey_policy` selects the policy that screens recipients. On a Token
   ACL mint it also predicts the gate for inline thaw: the gate must admit whoever this policy
   allows, or receives to new recipients fail rather than redirect. The gate may bind a different
   policy. Inline thaw needs a policy selected.

## Standing duties

- **Infrastructure owners in the policy.** `oft_store` (owner of `oft_escrow`), the fee deposit's
  owner and the redirect escrow's owner must be allowed by the gate's policy, and by the hook's
  policy on a hook mint. Whitelist them before switching a policy into Whitelist mode (from Open or
  Blacklist), and never blacklist them. The gate lets anyone freeze an empty account whose owner
  the policy blocks, so a blocked `oft_store` lets anyone freeze the empty escrow, which halts
  every send and receive, and re-freeze it after each thaw. Payloads stay retryable; once the
  owner is allowed again, anyone can thaw the escrow.
- **Transfer hook.** The mint's hook runs on the escrow → recipient credit, so it must admit every
  recipient the OFT's policy allows (and `oft_store` as source owner and authority). A refusal
  reverts the receive instead of redirecting; the payload stays retryable and delivers once the
  hook's configuration is fixed.
- **Keep the redirect escrow open.** On a transfer-hook mint every plan resolves the redirect
  escrow's hook accounts, so closing it makes planning fail for every message. Replace it, or
  disable redirect with `set_credit_redirect_config(None)`.
- **Keep the accepted TokenManager root** (`set_token_manager`) the root that holds the mint's PB
  authority. Its owning program receives the escrow's capped signature on every PB send.
- **Upgrade authority.** See [Deployment notes](../README.md#deployment-notes).

## Credit redirect

As on EVM, a credit goes to the redirect escrow when the recipient cannot take it: the policy
blocks the recipient, or the recipient's ATA is frozen and cannot be thawed (funded, no policy
selected, permissionless thaw disabled, Token ACL has no gate, or the mint not on Token ACL). The
escrow's owner pays redirected funds out. Without a redirect escrow those receives fail with
`CreditBlocked` and stay retryable.

A freeze on an empty ATA is not a durable hold: its owner can close it, and `lz_receive` re-creates
it unfrozen, unless the mint's DefaultAccountState is Frozen, and even then thaws it inline when
permissionless thaw admits the recipient. A funded frozen ATA cannot be closed. To hold a
recipient's credits, block it in the pubkey policy.

## Unsupported token configurations

- **Transfer fees.** Accounting assumes lossless transfers, as the EVM OFT does. While a
  Token-2022 transfer fee is non-zero in the current epoch, `send` and `lz_receive` fail with
  `TransferFeeActive`; receives stay retryable while the fee is live. Setting it back to zero takes
  effect two epochs later, and a live fee with a renounced fee authority blocks receives for good.
  A TransferFee extension at 0 bps is allowed.
- **Memo-required accounts.** The program issues no memo before its transfers, so crediting a
  destination with MemoTransfer enabled fails until it is disabled: a recipient or redirect escrow
  fails the receive, and the payload stays retryable; the fee deposit fails every send that collects a
  fee or decimal dust, so no message is sent. A sender's own memo requirement does not matter. The V1 OFT did not
  support memos either.
- **Confidential-only destinations.** The program moves only public balances. On a mint with
  confidential transfers, a destination that disables non-confidential credits refuses the credit
  (`NonConfidentialTransfersDisabled`) until it allows them again: a recipient or redirect escrow
  fails the receive, and the payload stays retryable; the fee deposit fails every send that collects
  a fee or decimal dust.
- **CPI Guard on the sending account.** `send` debits the sender in a CPI the sender signs, which
  CPI Guard refuses (`CpiGuardTransferBlocked`). The owner can lift the guard at the top level, so
  a guarded sender disables it, sends and re-enables it in one transaction. A guarded recipient
  receives normally.
- **Re-created mints.** `ld2sd_rate` is fixed at init; closing the mint and re-creating it at the
  same address with different decimals is not supported.

## Migrations

- **Successor TokenManager.** Follow the TokenManager procedure, then in the same transaction as
  the PB authority move: `set_token_manager(new root)` and the new root's Burner grant to
  `oft_escrow`.
- **Successor pubkey policy.** Records do not carry over, and a missing record is the default
  membership: Blacklist allows it, Whitelist blocks it. Populate records and roles first, then
  rebind the OFT (`set_pubkey_policy`), the gate (`init_acl`) and the hook (`init_transfer_hook`).
- **Successor gate.** Write the new gate's manifests first, switch the config's gate
  (`set_acl_gating_program` on the old root), then `sync_acl_gating_program`.
- **Successor OFT.** Pause, deliver, clear or burn pending payloads to the old receiver, restore
  rate-limit usage with `set_rate_limit_state`, then switch peers. A LockUnlock OFT's collateral
  stays in the old `oft_escrow`: Console OFT has no instruction that withdraws it, and the
  successor gets a new, empty escrow. The only administrative path is the mint's Permanent
  Delegate, on a Token-2022 mint whose Permanent Delegate and Token ACL authorities a TokenManager
  root holds: a `Freezer` freezes the old escrow, then DefaultAdmin `pd_recover`s its balance into
  the successor's escrow. On any other mint, fund the successor's escrow separately, or unwind the
  old escrow through deliveries to the old OFT before switching peers.
