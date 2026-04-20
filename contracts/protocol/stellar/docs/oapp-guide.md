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

## Example: Counter OApp

See `contracts/oapps/counter/` for a complete example demonstrating:

- Basic send/receive flow
- Ordered nonce enforcement
- Compose message handling
- ABA (request-response) pattern

## Key traits summary

| Trait                | Purpose                          | Default behavior                            |
| -------------------- | -------------------------------- | ------------------------------------------- |
| `OAppCore`           | Peer management, endpoint access | Stores endpoint, manages peers              |
| `OAppSenderInternal` | Send cross-chain messages        | Handles fee payment and message dispatch    |
| `OAppReceiver`       | Receive cross-chain messages     | Clears payload, delegates to `__lz_receive` |
| `LzReceiveInternal`  | Application message handling     | **Must implement**                          |
| `OAppOptionsType3`   | Enforced execution options       | No enforced options                         |
