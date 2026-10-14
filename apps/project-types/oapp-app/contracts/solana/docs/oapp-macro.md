# OApp Macro

## Overview

The `#[oapp]` attribute macro generates default Anchor instruction entrypoints and context structs for OApp instructions, while allowing developers to override any instruction with custom handlers and context structs.

This macro is built on the generic `anchor-trait` framework. For the override model (Default / Override), resolution rules, and framework API, see [`anchor-trait/README.md`](../../../../../../contracts/common/framework/solana/anchor-trait/README.md).

## `#[oapp]` Attribute Macro

### Syntax

```rust
#[oapp(
    state = StateType,
    role_type = RoleEnumType,
)]
pub mod my_oapp { ... }
```

### Parameters

| Parameter   | Required | Description                                                                                                                     |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `state`     | Yes      | OApp state account type. Must implement `OAppState<N>`.                                                                         |
| `role_type` | Yes      | Enum type implementing `rbac::RoleType` and `oapp::MessagingChannelRoles`. Used for RBAC enforcement on generated instructions. |

To override an instruction, annotate a function inside the module with `#[oapp_instruction]` — the function name determines which instruction is overridden. See [anchor-trait/README.md](../../../../../../contracts/common/framework/solana/anchor-trait/README.md) for the override model.

### What the Macro Generates

**Prelude** (emitted outside the module):

- `OAppPeer` account struct
- `EnforcedOptions` account struct
- Trait imports: `OAppState as _`, `MessagingChannelRoles as _`

**Per instruction** (subject to override level resolution — see anchor-trait spec):

1. Default context struct (always emitted for provided instructions)
2. Canonical entrypoint function (all levels)

**Module wrapping**: the user's module receives `#[::rbac_macros::rbac(state = <state>, role_type = <role>)]` and `#[program]`.

## OApp Instructions

| Instruction             | Params Type                | Return Type                      | View | Has Default | RBAC                             |
| ----------------------- | -------------------------- | -------------------------------- | ---- | ----------- | -------------------------------- |
| `set_peer`              | `SetPeerParams`            | `()`                             | No   | Yes         | `default_admin_role`             |
| `get_peer`              | `u32`                      | `Option<[u8; 32]>`               | Yes  | Yes         | —                                |
| `init_enforced_options` | `SetEnforcedOptionsParams` | `()`                             | No   | Yes         | `default_admin_role`             |
| `set_enforced_options`  | `SetEnforcedOptionsParams` | `()`                             | No   | Yes         | `default_admin_role`             |
| `get_enforced_options`  | `GetEnforcedOptionsParams` | `Option<Vec<u8>>`                | Yes  | Yes         | —                                |
| `next_nonce`            | `NextNonceParams`          | `u64`                            | Yes  | Yes         | —                                |
| `is_compose_msg_sender` | `IsComposeMsgSenderParams` | `bool`                           | Yes  | Yes         | —                                |
| `lz_receive_types_info` | `LzReceiveParams`          | `(u8, LzReceiveTypesV3Accounts)` | Yes  | No          | —                                |
| `lz_receive_types_v3`   | `LzReceiveParams`          | `u32` (required bytes)           | No   | No          | —                                |
| `lz_receive`            | `LzReceiveParams`          | `()`                             | No   | No          | —                                |
| `clear`                 | `ClearParams`              | `[u8; 32]` (payload hash)        | No   | Yes         | `messaging_channel_manager_role` |
| `skip`                  | `SkipParams`               | `()`                             | No   | Yes         | `messaging_channel_manager_role` |
| `burn`                  | `BurnParams`               | `()`                             | No   | Yes         | `messaging_channel_manager_role` |
| `nilify`                | `NilifyParams`             | `()`                             | No   | Yes         | `message_nilifier_role`          |

- **Has Default = Yes**: the macro auto-generates a complete entrypoint, context struct, and handler.
- **Has Default = No**: required override — users must provide a handler with `#[oapp_instruction]`. Omitting it is a compile error.
- **View = Yes**: entrypoint uses immutable `ctx: Context<T>`, handler receives `&ctx`.
- **RBAC**: admin instructions enforce role checks via `#[only_role]` on generated context structs using `RoleType::default_admin_role()`. Messaging-channel instructions use the roles from `oapp::MessagingChannelRoles` (meant to be distinct, which is not checked). The DefaultAdmin, as the Endpoint delegate, can call the Endpoint directly; these roles let other keys do it through the OApp.

`init_enforced_options` creates the `EnforcedOptions` PDA at the correct size for the initial options buffer via `init`. Subsequent updates (including resize) use `set_enforced_options`.

For default context structs and handler logic, see [`oapp-macros/src/instructions/`](../macros/src/instructions) (`InstructionSpec`).

## Extending Default Accounts

All provided OApp instructions support extending their default accounts via the `oapp_extend_accounts!` macro. This lets users add extra accounts to a default context struct without duplicating the base template.

This is a framework-level customization mechanism. Programs that publish `OAppInfo` v1 for standardized SDK discovery must not use this macro or a full `#[oapp_instruction]` account-context override to change the accounts of provided standard instructions resolved through OAppInfo v1. See the [OAppBase section](./oapp-info.md#oappbase) for the discovery constraint.

```rust
#[oapp(state = MyOApp, role_type = MyRole)]
pub mod my_oapp {
    #[oapp_instruction]
    pub fn set_peer(ctx: &mut Context<ExtSetPeer>, params: &SetPeerParams) -> Result<()> {
        ExtSetPeer::apply(ctx, params)?;        // reuse default handler
        ctx.accounts.peer_registry.register(params.peer)?;
        Ok(())
    }
}

// Extend StdSetPeer with an extra account.
// Must appear after the #[oapp] module.
oapp_extend_accounts!(set_peer, ExtSetPeer, {
    #[account(
        mut,
        seeds = [b"peer_registry", oapp.key().as_ref()],
        bump = peer_registry.bump,
    )]
    pub peer_registry: Account<'info, PeerRegistry>,
});
```

The extend macro inherits the default struct's attributes (`#[only_role]`, `#[event_cpi]`, `#[instruction]`), fields, and handler methods. The handler (`apply`) is copied to the extended struct via `Context<Self>`, so `ExtSetPeer::apply(ctx, params)` works identically to `StdSetPeer::apply(ctx, params)`.

Extra fields may reference base fields in Anchor constraints (e.g., `seeds = [b"x", oapp.key().as_ref()]`) since all fields are siblings in the generated struct.

For details on the framework mechanism, see the [Extending Default Accounts section in anchor-trait README](../../../../../../contracts/common/framework/solana/anchor-trait/README.md#extending-default-accounts).

## Auto-Generated State Types

The `#[oapp]` macro prelude generates the following account structs:

| Account           | PDA Seeds                                            | Description                                       |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------- |
| `OAppPeer`        | `[PEER_SEED, oapp.key(), eid.to_be_bytes()]`         | Stores a trusted remote peer address (`[u8; 32]`) |
| `EnforcedOptions` | `[ENFORCED_OPTIONS_SEED, oapp.key(), eid, msg_type]` | Stores enforced send options (`Vec<u8>`)          |

## RBAC Integration

Admin instructions use the `rbac::RoleType` trait directly. The macro generates `#[only_role(role = RoleType::default_admin_role(), ...)]` constraints, which inject a `role_member` PDA account into each admin context struct.

The `#[oapp]` macro also auto-applies `#[rbac_macros::rbac(...)]` to the module, which generates the standard RBAC instructions (`grant_role`, `revoke_role`, `renounce_role`, `begin_default_admin_transfer`, `accept_default_admin_transfer`, `get_default_admin`). See [RBAC README](../../../../../../contracts/common/utils/solana/rbac/README.md).

### `accept_default_admin_transfer` Override

The `#[oapp]` macro unconditionally injects a `#[rbac_instruction]` handler override for `accept_default_admin_transfer` that:

1. Calls `StdAcceptDefaultAdminTransfer::apply` to complete the RBAC admin transfer.
2. CPIs `set_delegate` on the endpoint, setting the new admin as the endpoint delegate.

This ensures the endpoint delegate is always kept in sync with the default admin — matching the EVM `OAppCoreRBACUpgradeable` behaviour. This handler is injected unconditionally; programs cannot override it via `#[oapp_instruction]`.

**Initialization requirement:** `initialize` must call `endpoint_cpi::register_oapp(...)` to create the `OAppRegistry` PDA. The OApp-specific transfer handler assumes this registry exists when it CPIs `set_delegate`; missing it can permanently brick admin transfers.

## Account Discovery

See [README.md](../README.md) for the full OApp standard overview, including the `OAppInfo` PDA design and SDK decision flow. `#[oapp]` does not initialize `OAppInfo`; applications populate that PDA in their own initialization flow.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│  oapp crate                                                                 │
│  pub use oapp_macros::*;  (re-exports all macros)                           │
├─────────────────────────────────────────────────────────────────────────────┤
│  src/                                                                       │
│    Traits: OAppState, MessagingChannelRoles                                 │
│    Params: SetPeerParams, LzReceiveParams, ClearParams, SkipParams, ...     │
│    V3 Types: LzReceiveTypesV3Result, LzReceiveTypesV3Accounts, ...          │
│    Common Types: AccountMetaRef, AddressLocator, ExecutionContextV1         │
│    OApp Info: OAppBase, IdlVersion, init_oapp_base!                         │
│    Options: combine_options, assert_type_3                                  │
│    Events: PeerSet, EnforcedOptionsSet                                      │
│    Errors: OAppError                                                        │
│    Endpoint CPI: register_oapp, set_delegate, send, quote, clear,           │
│      skip, burn, nilify, send_compose, clear_compose                        │
│    Seed Constants: PEER_SEED, ENFORCED_OPTIONS_SEED, NONCE_SEED, ...        │
├─────────────────────────────────────────────────────────────────────────────┤
│  macros/ (oapp-macros proc-macro sub-crate)                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  #[oapp] attribute macro                                              │  │
│  │    - Parses state, role_type                                          │  │
│  │    - Delegates to anchor-trait framework:                             │  │
│  │      collect overrides → generate instructions → assemble output      │  │
│  │    - Injects accept_default_admin_transfer override                   │  │
│  │      (#[rbac_instruction]) for endpoint delegate sync                 │  │
│  │  #[composer] attribute macro                                          │  │
│  │    - Generates composer program entrypoints                           │  │
│  │    - lz_compose, lz_compose_types_v3, lz_compose_types_info           │  │
│  ├───────────────────────────────────────────────────────────────────────┤  │
│  │  Per-instruction generators (instructions/)                           │  │
│  │    OApp: 14 instructions (set_peer, get_peer,                         │  │
│  │      init_enforced_options, set_enforced_options,                     │  │
│  │      get_enforced_options, next_nonce, is_compose_msg_sender,         │  │
│  │      lz_receive_types_info, lz_receive_types_v3, lz_receive,          │  │
│  │      clear, skip, burn, nilify)                                       │  │
│  │    Composer: 3 instructions (lz_compose,                              │  │
│  │      lz_compose_types_v3, lz_compose_types_info)                      │  │
│  └──────────────────────────────┬────────────────────────────────────────┘  │
│                                 │ uses                                      │
│                                 ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  anchor-trait crate (external dependency of macros/)                  │  │
│  │  Override model, InstructionOverrides, generate_instructions,         │  │
│  │  Assembly (see anchor-trait/README.md)                                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘

Generated code emits ::oapp:: paths, resolved at macro expansion in user programs.
```
