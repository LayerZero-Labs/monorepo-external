# Pubkey policy hook — Solana

`pubkey_policy_hook` is an optional Token-2022 transfer hook. On every transfer it checks the
source owner, the destination owner and the executing authority against the pubkey policy bound
into the mint's manifest; the Permanent Delegate is exempt. The mint's hook-update authority binds
or re-binds the policy with `init_transfer_hook`, and only a policy for the mint binds. Handing that
authority to a token-manager root's `TransferHook` signer puts rebinding under its DefaultAdmin
(`set_transfer_hook_policy`).

`init_transfer_hook`'s `authority` is an unchecked account, so generated clients mark it as a
non-signer. A plain key or a CPI-signing PDA must be passed as a signer; a native multisig is passed
as a non-signer, with its member signers appended as signing remaining accounts.

The hook screens transfers only. Token-2022's `SetAuthority(AccountOwner)` reassigns a token
account, balance included, without a transfer, so it never runs the hook: a blocked owner of a
non-ATA account can hand it to an allowed key. ATAs (`ImmutableOwner`) and frozen accounts cannot be
reassigned, so blocking a holder means freezing their accounts too.

It is used alongside the [token manager](../token-manager/README.md), whose README and
[usage doc](../token-manager/docs/usage.md) cover setup with Token ACL; the cross-program scenarios
that exercise the hook live in token-manager's integration suite.

## Build and test

```bash
pnpm build       # anchor build + IDL and TS type generation
pnpm test:rust   # host tests in programs/pubkey_policy_hook/tests
pnpm lint        # rustfmt --check + clippy -D warnings
```

Every command runs through the repo Docker VM tooling (`lz-tool anchor`).

`PUBKEY_POLICY_HOOK_ID` sets the program ID compiled into the binary and IDL; the default is the
development ID `7HTVK1Jwzjd4yRGCZnLT4QmwhmZidurFxwz2RMAiUyzk`. `lz-tool` does not pass host
environment variables into its container, so pass it explicitly:

```sh
pnpm exec lz-tool --env PUBKEY_POLICY_HOOK_ID=<pubkey> --script 'sh scripts/build.sh' anchor
```
