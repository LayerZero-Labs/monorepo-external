# Building OApps on Stellar

This guide explains how to build Omnichain Applications (OApps) using the LayerZero V2 framework on Stellar.

## Overview

An OApp is a cross-chain application that can send and receive messages through LayerZero. The framework provides:

- **OAppCore**: Foundation for all OApp functionality (peer management, endpoint access)
- **OAppSenderInternal**: Enables sending cross-chain messages
- **OAppReceiver**: Handles incoming cross-chain messages
- **LzReceiveInternal**: Application-specific message handling logic
- **OAppOptionsType3**: Manages enforced options for message execution

## Quick start

The `#[oapp]` macro provides the simplest way to create an OApp:

```rust
use oapp::oapp_receiver::LzReceiveInternal;
use oapp_macros::oapp;

#[lz_contract]
#[oapp]
pub struct MyOApp;

impl LzReceiveInternal for MyOApp {
    fn __lz_receive(
        env: &Env,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        executor: &Address,
        value: i128,
    ) {
        // Your message handling logic here
    }
}
```

The macro generates only OApp trait implementations. You must apply a contract macro such as
`#[common_macros::lz_contract]` to the struct. `#[lz_contract]` provides:

- `#[soroban_sdk::contract]` — makes the struct a Soroban contract
- `#[common_macros::ownable]` or `#[common_macros::multisig]` — Auth (use `#[lz_contract(multisig)]` for multisig)
- `#[common_macros::ttl_configurable]` — adds TTL configuration with auth
- `#[common_macros::ttl_extendable]` — adds manual TTL extension support

The `#[oapp]` macro generates:

- `OAppCore` implementation
- `OAppSenderInternal` implementation
- `OAppReceiver` implementation
- `OAppOptionsType3` implementation

## Initialization

Initialize your OApp in the constructor:

```rust
use oapp::oapp_core::init_ownable_oapp;

#[contract_impl]
impl MyOApp {
    pub fn __constructor(env: &Env, owner: &Address, endpoint: &Address, delegate: &Address) {
        init_ownable_oapp::<Self>(env, owner, endpoint, delegate);
    }
}
```

The `init_ownable_oapp` function:

1. Sets the contract owner
2. Stores the LayerZero endpoint address
3. Sets a delegate on the endpoint

## Access control

OApps use a two-layer authorization model. The `Auth` trait returns the contract's authorizer — the owner under `#[lz_contract]`, or the contract itself under `#[lz_contract(multisig)]`. On top of that, `RoleBasedAccessControl` adds OpenZeppelin-style role membership so administrative actions can be delegated without surrendering ownership. A vanilla `#[lz_contract] #[oapp]` contract exposes both layers automatically.

### Custom roles

Declare a role as a `&str` constant and gate methods with `#[only_role]` (role check + `require_auth`) or `#[has_role]` (role check only — use when the address has already been authenticated to avoid a duplicate `require_auth` panic):

```rust
use common_macros::only_role;

pub const CONFIG_MANAGER_ROLE: &str = "CONFIG_MANAGER";

#[contract_impl]
impl MyOApp {
    #[only_role(operator, CONFIG_MANAGER_ROLE)]
    pub fn set_config(env: &Env, value: u64, operator: &Address) {
        // operator must hold CONFIG_MANAGER_ROLE
    }
}
```

The role argument is expanded to `Symbol::new(env, ROLE)` internally.

### Managing roles

The standard RBAC entry points are auto-exposed by `#[oapp]`:

```rust
let role = Symbol::new(env, "CONFIG_MANAGER");

oapp_client.grant_role(&account, &role, &caller);     // authorizer or role-admin
oapp_client.revoke_role(&account, &role, &caller);    // authorizer or role-admin
oapp_client.renounce_role(&role, &account);           // self only
oapp_client.set_role_admin(&role, &admin_role);       // authorizer only
oapp_client.remove_role_admin(&role);                 // authorizer only

oapp_client.has_role(&account, &role);                // Option<u32>
oapp_client.get_role_admin(&role);                    // Option<Symbol>
oapp_client.get_role_member_count(&role);             // u32
oapp_client.get_role_member(&role, index);            // Address — panics if out of bounds
oapp_client.get_existing_roles();                     // Vec<Symbol>, capped at 256
```

Operations emit `RoleGranted`, `RoleRevoked`, and `RoleAdminChanged` events; failures surface as `RbacError` variants (`Unauthorized`, `RoleNotHeld`, `AdminRoleNotFound`, `MaxRolesExceeded`, etc.).

### Constructor-time setup

Constructors run before an authorizer is in scope, so use the `_no_auth` helpers to seed roles:

```rust
use utils::rbac::{grant_role_no_auth, set_role_admin_no_auth};

#[contract_impl]
impl MyOApp {
    pub fn __constructor(
        env: &Env,
        owner: &Address,
        endpoint: &Address,
        delegate: &Address,
        config_manager: &Address,
    ) {
        init_ownable_oapp::<Self>(env, owner, endpoint, delegate);

        let role = Symbol::new(env, "CONFIG_MANAGER");
        grant_role_no_auth(env, config_manager, &role, owner);
        set_role_admin_no_auth(env, &role, &Symbol::new(env, "CONFIG_ADMIN"));
    }
}
```

## Peer management

Before sending or receiving messages, configure peers for each destination chain:

```rust
// Set a peer (owner only). Pass owner as operator (reserved for future RBAC).
oapp.set_peer(env, dst_eid, &Some(peer_address_bytes32), &owner);

// Remove a peer
oapp.set_peer(env, dst_eid, &None, &owner);

// Query a peer
let peer = oapp.peer(env, dst_eid);
```

Peers are stored as `BytesN<32>` to maintain cross-chain address compatibility.

## Sending messages

Use the internal sender methods to send cross-chain messages:

```rust
use oapp::oapp_sender::{FeePayer, OAppSenderInternal};

impl MyOApp {
    pub fn send_message(env: &Env, caller: &Address, dst_eid: u32, message: &Bytes, options: &Bytes, fee: &MessagingFee) {
        caller.require_auth();

        // Send the message — caller already authorized, use FeePayer::Verified to avoid
        // a duplicate require_auth() node in the Soroban auth tree.
        Self::__lz_send(env, dst_eid, message, options, &FeePayer::Verified(caller.clone()), fee, caller);
    }

    pub fn quote(env: &Env, dst_eid: u32, message: &Bytes, options: &Bytes, pay_in_zro: bool) -> MessagingFee {
        Self::__quote(env, dst_eid, message, options, pay_in_zro)
    }
}
```

The `__lz_send` method accepts a [`FeePayer`] enum that indicates authorization state:

- `FeePayer::Unverified(addr)` — Safe default. `__lz_send` will call `addr.require_auth()`.
- `FeePayer::Verified(addr)` — Caller already called `require_auth()` on this address.

The method then:

1. Transfers the native fee from the payer to the endpoint
2. Transfers the ZRO fee if applicable
3. Looks up the peer for the destination
4. Calls the endpoint's `send` function

## Receiving messages

Implement `LzReceiveInternal` to handle incoming messages:

```rust
impl LzReceiveInternal for MyOApp {
    fn __lz_receive(
        env: &Env,
        origin: &Origin,      // Contains src_eid, sender, nonce
        guid: &BytesN<32>,    // Unique message identifier
        message: &Bytes,      // The message payload
        extra_data: &Bytes,   // Additional data from executor
        executor: &Address,   // Executor who delivered the message
        value: i128,          // Native token value sent with message
    ) {
        // Your message handling logic
        // Note: clear_payload_and_transfer is called automatically before this
    }
}
```

The default `lz_receive` flow:

1. Requires executor authorization
2. Transfers native value from executor to OApp (if any)
3. Verifies the sender matches the configured peer
4. Clears the payload from the endpoint
5. Calls your `__lz_receive` implementation

## Custom implementations

Use `#[oapp(custom = [...])]` to override default behavior:

### Custom receiver (ordered delivery)

```rust
#[common_macros::lz_contract]
#[oapp(custom = [receiver])]
pub struct MyOrderedOApp;

impl LzReceiveInternal for MyOrderedOApp {
    fn __lz_receive(env: &Env, origin: &Origin, ...) {
        // Your logic here
    }
}

#[contract_impl(contracttrait)]
impl OAppReceiver for MyOrderedOApp {
    fn next_nonce(env: &Env, src_eid: u32, sender: &BytesN<32>) -> u64 {
        // Return expected nonce for ordered delivery
        // Return 0 for unordered (default)
        Storage::max_received_nonce(env, src_eid, sender) + 1
    }
}
```

### Custom core (version override)

```rust
#[oapp(custom = [core])]
pub struct MyOApp;

#[contract_impl(contracttrait)]
#[common_macros::ownable]
impl OAppCore for MyOApp {
    fn oapp_version(_env: &Env) -> (u64, u64) {
        (2, 1)  // Custom version
    }
}
```

### Multiple custom implementations

```rust
#[oapp(custom = [core, receiver, options_type3])]
pub struct MyCustomOApp;

// Implement each trait manually...
```

## Debugging and recovering messages

An inbound path is tracked by `(receiver, src_eid, sender)` and guarded by an Endpoint nonce.
A message can only be delivered — via `lz_receive` (on the OApp) or `clear` (on the Endpoint) — once its nonce is at or below
`inbound_nonce`, and `inbound_nonce` only advances across the gapless prefix of verified, skipped,
or nilified nonces. Two very different situations are worth separating:

- **A verification gap truly stalls the channel.** If a lower nonce is never verified, `inbound_nonce`
  stops before it, so every nonce at or above the gap becomes undeliverable until the gap is resolved
  (for example, verified or skipped).
- **A reverting `lz_receive` does not, by itself, block later nonces.** The payload hash stays stored,
  so that nonce can be retried or cleared. Whether a stuck nonce holds up higher ones depends on
  whether the OApp enforces ordered delivery via `next_nonce` (the default returns `0`, i.e. unordered).

The Endpoint exposes four channel-management operations for an OApp to recover from these situations.
They are the on-chain equivalents of the skip / clear / nilify / burn flow described for other VMs.

### Authorization

All four operations are gated by `require_oapp_auth`: the `caller` must be **the OApp contract
itself or its registered delegate**, and `caller.require_auth()` is enforced. The `receiver`
argument is always the OApp address. Two calling patterns are available:

- **Delegate calls the endpoint directly** — the delegate set via `set_delegate` (typically the
  owner or an admin) invokes the endpoint, passing itself as `caller` and the OApp as `receiver`.
- **OApp wraps the call** — add an admin-gated method on the OApp that reaches the endpoint through
  the shared client and passes the OApp as both `caller` and `receiver`:

    ```rust
    use oapp::oapp_core::endpoint_client;

    #[contract_impl]
    impl MyOApp {
        #[only_role(operator, MESSAGE_ADMIN_ROLE)]
        pub fn skip_message(env: &Env, src_eid: u32, sender: &BytesN<32>, nonce: u64, operator: &Address) {
            let oapp = env.current_contract_address();
            endpoint_client::<Self>(env).skip(&oapp, &oapp, &src_eid, sender, &nonce);
        }
    }
    ```

`endpoint_client::<Self>(env)` returns the endpoint client, which exposes `skip`, `clear`, `nilify`,
and `burn` alongside a read-only `inbound_payload_hash` for inspecting stored payloads.

### Skip

Skips the next expected inbound nonce **before it is verified**. Use this to bypass a message you
never want delivered (e.g. flagged by a precrime alert) so the channel keeps advancing.

```rust
endpoint.skip(&caller, &receiver, src_eid, &sender, nonce);
```

- `nonce` **must** be the next expected nonce (`inbound_nonce + 1`), otherwise the call fails with
  `EndpointError::InvalidNonce`.
- The skipped nonce counts as "verified" for ordering purposes, so subsequent nonces can proceed.
- Emits `InboundNonceSkipped`.

### Clear

Clears a **verified** message from the channel without running your `__lz_receive` logic. This is the
PULL-mode counterpart to `lz_receive`: use it to accept-and-drop a payload that can never execute
successfully but that you want to move past.

```rust
endpoint.clear(&caller, &origin, &receiver, &guid, &message);
```

- Requires the reconstructed payload (`guid` + `message`) to match the stored payload hash for the
  nonce carried in `origin`; a missing or mismatched hash fails with
  `EndpointError::PayloadHashNotFound`.
- The nonce must be at or below `inbound_nonce`, otherwise the call fails with
  `EndpointError::InvalidNonce`.
- Removes the stored payload hash and emits `PacketDelivered`, but does **not** advance
  `inbound_nonce`; nonce advancement happens during `verify`, `skip`, or `nilify`.

### Nilify

Marks a message as nil so it **cannot execute until it is re-verified**. Unlike `burn`, the message
can be verified again later, making this the recoverable option for temporarily blocking a nonce.

```rust
endpoint.nilify(&caller, &receiver, src_eid, &sender, nonce, &payload_hash);
```

- `payload_hash` must match the currently stored hash; a mismatch fails with
  `EndpointError::PayloadHashNotFound`.
- Pass `None` only when no hash is stored yet, and only for a future nonce inside the pending window
  (`inbound_nonce < nonce <= inbound_nonce + 256`).
- Sets the stored hash to the NIL sentinel; a fresh `verify` can restore it.
- Emits `PacketNilified`.

### Burn

Permanently marks a nonce as **unexecutable and un-verifiable** — it can never be re-verified or
executed. Use this as the terminal action for a message you have decided to discard for good.

```rust
endpoint.burn(&caller, &receiver, src_eid, &sender, nonce, &payload_hash);
```

- There must be a matching stored payload hash — possibly the NIL sentinel left by `nilify` — at the
  target nonce. A missing or mismatched hash fails with `EndpointError::PayloadHashNotFound`.
- `nonce` must be at or below `inbound_nonce`; otherwise the call fails with
  `EndpointError::InvalidNonce`.
- Removes the payload hash from storage and emits `PacketBurnt`.

## Example: Counter OApp

See `contracts/oapps/counter/` for a complete example demonstrating:

- Basic send/receive flow
- Ordered nonce enforcement
- Compose message handling
- ABA (request-response) pattern

## Key traits summary

| Trait                    | Purpose                          | Default behavior                                                |
| ------------------------ | -------------------------------- | --------------------------------------------------------------- |
| `OAppCore`               | Peer management, endpoint access | Stores endpoint, manages peers                                  |
| `OAppSenderInternal`     | Send cross-chain messages        | Handles fee payment and message dispatch                        |
| `OAppReceiver`           | Receive cross-chain messages     | Clears payload, delegates to `__lz_receive`                     |
| `LzReceiveInternal`      | Application message handling     | **Must implement**                                              |
| `OAppOptionsType3`       | Enforced execution options       | No enforced options                                             |
| `RoleBasedAccessControl` | Role-based access control        | Provided automatically; manages role grants and admin hierarchy |
