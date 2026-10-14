# Token Manager (Solana) — Audit Scope

One production program and the interface crate its consumers compile in:

- `token_manager`: one root per Token-2022 mint. RBAC over the native authorities its signer PDAs hold (Token ACL logical admin, PermissionedBurn, Permanent Delegate, Pause, mint authority, transfer-hook authority), Token ACL's permissionless gate callbacks, role-gated freeze/thaw, pause/unpause and minting, permissioned-burn approval, and Permanent Delegate burn/recover.
- `token-manager-interface`: the root and signer-PDA ABI, the `permissioned_burn` instruction builder, and the Token ACL helpers (manifests, planning and permissionless thaw) that consumers such as Console OFT run in their own program.

The pubkey policies the gate reads belong to the separately scoped [pubkey-policy](../../../../../contracts/common/utils/solana/pubkey-policy/AUDIT.md) program, and the optional transfer hook is the separately scoped [pubkey-policy-hook](../pubkey-policy-hook/AUDIT.md). RBAC comes from the separately scoped [rbac](../../../../../contracts/common/utils/solana/rbac/AUDIT.md) crate, and build-time program IDs from [program-id](../../../../../contracts/common/utils/solana/program-id/AUDIT.md).

For architecture details, see the [README](./README.md) and [`docs/usage.md`](./docs/usage.md).

---

## Files in Scope

### Program: `token_manager` (`programs/token_manager/src/`)

| File                                                     | Description                                                                                                                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lib.rs`                                                 | Program ID and instruction surface: root creation, native authorities, permissioned burn, PD burn/recover, pause, mint, Token ACL, transfer-hook policy                              |
| `state.rs`                                               | Re-exports the root state ABI from `token-manager-interface`                                                                                                                         |
| `types.rs`                                               | `RoleType`: DefaultAdmin, Freezer, Thawer, Burner, PdBurner, Pauser, Unpauser, Minter                                                                                                |
| `authority.rs`                                           | Native-authority proofs (plain signer, CPI-signing PDA, native multisig), signing as one signer PDA, and acting as a native authority directly or as one member of a 1-of-n multisig |
| `errors.rs`                                              | `TokenManagerError` (7000-7011, 10002) after the shared `PolicyError` variants (8000-8004)                                                                                           |
| `events.rs`                                              | 13 events for root, authority, burn, ACL, hook-policy, recovery, pause and mint changes                                                                                              |
| `instructions/root/init_token_manager.rs`                | Creates the mint's single root, authorized by any live native authority holder                                                                                                       |
| `instructions/root/rbac_default_admin.rs`                | Pending-admin acceptance and bootstrap re-pointing before a DefaultAdmin exists                                                                                                      |
| `instructions/native_authority/set_native_authority.rs`  | DefaultAdmin moves a signer PDA's native authority, held directly or through a 1-of-n native multisig, to another non-null key                                                       |
| `instructions/transfer_hook/set_transfer_hook_policy.rs` | DefaultAdmin binds the pubkey-policy hook's policy, signing as the root's TransferHook signer                                                                                        |
| `instructions/permissioned_burn/burn.rs`                 | Burner-approved Token-2022 PermissionedBurn; approval and token spending stay separate capabilities                                                                                  |
| `instructions/permanent_delegate/pd_burn.rs`             | PdBurner burns from any account as the Permanent Delegate, with the PB signer's approval while a PB authority exists                                                                 |
| `instructions/permanent_delegate/pd_recover.rs`          | DefaultAdmin moves a frozen account's funds as the Permanent Delegate and re-freezes it                                                                                              |
| `instructions/pause/set_paused.rs`                       | Pauser pauses and Unpauser resumes as the root's Pause signer; the pause CPI `pd_recover` shares                                                                                     |
| `instructions/mint/mint_to.rs`                           | Minter mints as the root's Mint signer                                                                                                                                               |
| `instructions/acl/init_acl.rs`                           | Binds a created pubkey policy into both Token ACL gate manifests                                                                                                                     |
| `instructions/acl/gate.rs`                               | `can_thaw_permissionless` / `can_freeze_permissionless`: approve only empty accounts of the policy subject for this mint (`InvalidTokenAccount` otherwise), per the policy           |
| `instructions/acl/freeze_token_account.rs`               | Freezer-gated freeze through Token ACL                                                                                                                                               |
| `instructions/acl/thaw_token_account.rs`                 | Thawer-gated thaw through Token ACL                                                                                                                                                  |
| `instructions/acl/manage_acl.rs`                         | DefaultAdmin toggles permissionless freeze/thaw and points the MintConfig at another gating program                                                                                  |
| `instructions/acl/helpers.rs`                            | Token ACL CPIs and MintConfig reads shared by the handlers                                                                                                                           |
| `instructions/get_version.rs`                            | View returning the program's build versions                                                                                                                                          |
| `instructions/mod.rs`, `instructions/*/mod.rs`           | Module wiring                                                                                                                                                                        |

### Interface crate: `token-manager-interface` (`interface/src/`)

| File              | Description                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| `lib.rs`          | Program ID and module exports                                                                     |
| `state.rs`        | `TokenManagerStore` and `SignerKind`                                                              |
| `seeds.rs`        | Root and signer-PDA seeds and canonical addresses                                                 |
| `burn.rs`         | `permissioned_burn` instruction builder and discriminator for consumers                           |
| `acl/mod.rs`      | Token ACL helpers for consumers: canonical MintConfig, whether ACL is required, errors            |
| `acl/manifest.rs` | Gate manifests, their account recipe, and thaw planning                                           |
| `acl/thaw.rs`     | Account emptiness and `ThawAccounts::thaw_if_eligible`, the consumer-side permissionless thaw CPI |
| `version.rs`      | `ProgramVersion` returned by `get_version`                                                        |

### Crate Manifests

| File                                | Description                                                 |
| ----------------------------------- | ----------------------------------------------------------- |
| `Cargo.toml`                        | Workspace members, dependency pins and release profile      |
| `interface/Cargo.toml`              | Interface crate dependencies and features                   |
| `programs/token_manager/Cargo.toml` | `token_manager` package metadata, features and dependencies |

---

## Out of Scope

| Path                       | Reason                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dependencies/`            | Local copies of dependency packages covered by separate audit scopes (`anchor-trait`, `program-id`, `pubkey-policy`, `pubkey-policy-hook`, `rbac`) |
| `tests/`                   | Mollusk integration suites, including the hook's                                                                                                   |
| `fixtures/`                | Test-only Token ACL and Token-2022 SBF programs re-exporting pinned upstream entrypoints; built by `pnpm build` for consumers' tests               |
| `programs/*/tests/`        | Program-local Rust tests                                                                                                                           |
| `scripts/`                 | Build, build-output and IDL checks and test scripts                                                                                                |
| `docs/`                    | Operator documentation (non-executable)                                                                                                            |
| `Anchor.toml`              | Anchor framework configuration                                                                                                                     |
| `AUDIT.md`                 | This file                                                                                                                                          |
| `Cargo.lock`               | Dependency lock file                                                                                                                               |
| `turbo-snapshot.lock.json` | Build snapshot lock                                                                                                                                |
| `package.json`             | NPM package configuration                                                                                                                          |
| `README.md`                | Documentation                                                                                                                                      |
| `rust-toolchain.toml`      | Toolchain pinning                                                                                                                                  |
| `rustfmt.toml`             | Formatting configuration                                                                                                                           |
| `turbo.json`               | Turborepo configuration                                                                                                                            |

> **Note:** Inline `#[cfg(test)] mod tests { ... }` blocks within in-scope source files are also out of scope.
