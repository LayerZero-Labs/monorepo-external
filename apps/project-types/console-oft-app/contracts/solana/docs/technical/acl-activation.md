# Inline ACL activation

OFT owns delivery and ATA creation. `token-manager-interface` owns the reusable validation and
native invocation helper. Token Manager owns the permissionless gate policy and administrative
operations. Native ACL owns its transient callback flag and signs the actual Token-2022 thaw.

```text
lz_receive / forwarding lz_compose
  ├─ Associated Token: create destination if missing
  ├─ interface: validate selected policy, canonical config and manifest, empty balances
  ├─ native ACL: ThawPermissionlessIdempotent
  │    ├─ manager: authenticated can_thaw_permissionless callback
  │    └─ Token-2022: thaw, signed by native ACL
  └─ reload destination → existing clear / credit / compose flow
```

The interface is ordinary Rust code linked into the consumer. It is not another CPI or program,
and does not provide an arbitrary target, instruction-data or signer-seeds escape hatch. The
manager is not active when ACL enters its callback.

## Three distinct authorities

| Responsibility                      | Binding / enforcement                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Administer native ACL configuration | `MintConfig.freeze_authority`; manager admin operations still validate it                                 |
| Decide permissionless thaw policy   | `MintConfig.gating_program` plus the `PubkeyPolicy` the gate manifest binds and its subject-record recipe |
| Perform the native thaw             | The mint's native freeze authority is the ACL config PDA; only native ACL signs for it                    |

Native ACL administration and gate binding are distinct fields. A TokenManager root administers
ACL through its ACL signer PDA until `set_native_authority` moves that authority elsewhere. The OFT
does not compare its selected policy with the gate manifest's binding or with the logical admin;
Token ACL resolves the gate's own accounts and the gate applies its own policy. Clearing the policy
remains supported and does not remove the mint's native freeze control.

## Proof boundaries and fallback

- `ValidatedPubkeyPolicy::read` authenticates the subject's canonical record before computing the
  policy answer. The caller first binds the policy to its own configured selection and mint
  (`resolve_pubkey_policy`), never to arbitrary instruction arguments.
- `acl::requires_acl` uses the live mint freeze authority and the stored policy selection. Optional
  supplied accounts cannot disable it. When required, the complete ACL bundle must be supplied,
  including for already-unfrozen destinations and disabled permissionless thaw.
- `acl::thaw_extra_count` reads the config's gating program and requires the supplied manifest to
  be that gate's canonical thaw manifest, owned by the gate. A canonical unallocated system account
  means the gate has no manifest (no extras), not an omitted slot.
- `ThawAccounts::thaw_if_eligible` checks the mint, token account and owner against the validated
  policy answer and reads the config's permissionless-thaw flag. It does not compare the OFT's
  policy with the gate's manifest: the OFT's policy only decides whether to attempt the thaw.
  Token ACL resolves the gate's extras from its manifest and rejects any that do not match, the gate
  applies its own policy, and Token ACL and the runtime check the flag account, programs and payer.
  A gate that refuses fails the CPI and the delivery, which stays retryable. Disabled permissionless
  thaw, a config with no gate (`Pubkey::default()`), a subject the OFT blocks and a funded frozen
  account leave the account frozen. The payer is passed writable because Token ACL refunds the
  transient flag account's lamports to it.
- Empty means zero public balance and closable withheld/confidential balances, not account freshness.
  The native gate and the consumer use the same emptiness implementation.
- Native CPI errors propagate. A successful thaw is followed by `reload()` before routing. Failure
  later in delivery rolls back ATA creation, thaw and Endpoint clear along with credit.

These are activation guarantees, **not** a claim that every Token-2022 extension permits transfer.
Send/PB authorization, hook policy, redirect custody, generic plan wire format and credit-account
group parsing are outside this path.

When ACL is not required, `LzReceive`'s five `acl_*` slots are Anchor's read-only program-ID `None`
sentinel, so the policy-only path adds no ACL addresses. The flag, config and gate manifest are
never signers.

## Evidence and reproduction

Core sources:

- [Shared interface](../../../../../../token-app/contracts/solana/token-manager/interface/src/acl/thaw.rs) and
  [validated policy](../../../../../../../contracts/common/utils/solana/pubkey-policy/interface/src/pubkey_policy.rs).
- [Native manager gate](../../../../../../token-app/contracts/solana/token-manager/programs/token_manager/src/instructions/acl/gate.rs).
- [Policy setter](../../programs/console_oft/src/instructions/set_pubkey_policy.rs),
  [receive](../../programs/console_oft/src/instructions/lz_receive.rs), and
  [planner](../../programs/console_oft/src/instructions/lz_receive_types_v3.rs).
- [SBF regression tests](../../tests/integration/receive.rs) execute the emitted plans using
  native ACL/Token-2022 and Endpoint binaries. They cover externally administered native ACL
  state with an unchanged manifest (explicit fixture setup, not a manager handoff API),
  live gate/policy changes, omitted and
  malformed inputs, existing ATA/no-op, funded holds, native CPI failure and post-thaw rollback.
- [Client ABI tests](../../tests/sdk/acl-interface.test.ts) verify generated account order, optional
  sentinels and privileges.

From this package, after building SBF fixtures and regenerating clients:

```sh
pnpm exec lz-tool --script 'cargo test -p console-oft -p console-oft-integration-tests --locked' anchor
pnpm exec vitest run --config vitest.sdk.config.ts
node --import tsx scripts/profile-acl.ts
```

Run the token-manager workspace tests separately. Its activation tests exercise withheld and
confidential balances; its interface tests exercise binding and malformed recipes.

Resource measurements are in the [send/receive profile](send-receive-profile.md). Add
`--include-send` to the profiler command for both directions. It executes SBF delivery and
separately compiles the receive Executor pre/post envelope; those bracket instructions are not
included in delivery CU.
