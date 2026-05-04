# Building OFTs on Stellar

This guide explains how to build Omnichain Fungible Tokens (OFTs) using the LayerZero V2 framework on Stellar.

## Overview

An OFT enables cross-chain token transfers through LayerZero. The framework provides:

- **OFTCore**: Public interface for token transfers (quote, send)
- **OFTInternal**: Internal logic for debit/credit operations
- **Token types**: MintBurn and LockUnlock strategies
- **Extensions**: Pausable, fee collection, rate limiting

### Classic Assets Receiving Requirements

#### G-Address (EOA)

G-address recipients must meet two prerequisites before they can receive classic assets:

1. **Account activation**: The account must hold a minimum of 1 XLM to exist on the Stellar network.
2. **Trustline**: The account must have an explicit trustline for the classic asset being received.

If `lz_receive` fails due to unmet prerequisites, delivery can be retried once the recipient account is activated and the trustline is established.

#### C-Address (Smart Contract)

C-address recipients are not subject to these restrictions. As long as the contract address exists on-chain, it can receive assets directly.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         OFT Contract                         │
├─────────────────────────────────────────────────────────────-┤
│  OFTCore (public interface)                                  │
│  ├── quote_oft()     - Quote transfer limits and fees        │
│  ├── quote_send()    - Quote LayerZero messaging fees        │
│  └── send()          - Execute cross-chain transfer          │
├─────────────────────────────────────────────────────────────-┤
│  OFTInternal (internal logic)                                │
│  ├── __debit()       - Burn/lock tokens on send              │
│  ├── __credit()      - Mint/unlock tokens on receive         │
│  └── __receive()     - Handle incoming transfers             │
├─────────────────────────────────────────────────────────────-┤
│  Extensions (optional)                                       │
│  ├── OFTPausable     - Pause/unpause operations              │
│  ├── OFTFee          - Collect transfer fees                 │
│  └── RateLimiter     - Limit transfer volume                 │
└─────────────────────────────────────────────────────────────-┘
```

## Token types

### MintBurn

Burns tokens on send, mints on receive. Use when the OFT contract has mint/burn authority.

```rust
use oft::mint_burn;

impl OFTInternal for MyOFT {
    fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> OFTReceipt {
        mint_burn::debit::<Self>(env, sender, amount_ld, min_amount_ld, dst_eid)
    }

    fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128 {
        mint_burn::credit::<Self>(env, to, amount_ld, src_eid)
    }
}
```

When the underlying token is a Stellar Classic Asset wrapped as a SAC, you can route mints through the [SAC Manager](#sac-manager) instead of granting raw SAC admin authority to the OFT contract.

### LockUnlock

Locks tokens in contract on send, unlocks on receive. Use for wrapping existing tokens (OFT Adapter pattern).

```rust
use oft::lock_unlock;

impl OFTInternal for MyOFT {
    fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> OFTReceipt {
        lock_unlock::debit::<Self>(env, sender, amount_ld, min_amount_ld, dst_eid)
    }

    fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128 {
        lock_unlock::credit::<Self>(env, to, amount_ld, src_eid)
    }
}
```

## Quick start

### Using the pre-built OFT

The `oft` crate provides a ready-to-use OFT with all extensions:

```rust
use oft::OFT;

// Deploy with:
// - token: underlying token address
// - owner: contract owner
// - endpoint: LayerZero endpoint address
// - delegate: optional endpoint delegate
// - shared_decimals: cross-chain decimal precision
// - oft_type: OftType::MintBurn or OftType::LockUnlock
```

### Building a custom OFT

```rust
use oapp_macros::oapp;
use oft_core::{OFTCore, OFTInternal, impl_oft_lz_receive, types::OFTReceipt};
use oft::mint_burn;

#[oapp]
pub struct MyOFT;

#[contract_impl]
impl MyOFT {
    pub fn __constructor(
        env: &Env,
        token: &Address,
        owner: &Address,
        endpoint: &Address,
        delegate: &Address,
    ) {
        // shared_decimals = 6 is common for cross-chain compatibility
        Self::__initialize_oft(env, token, 6, owner, endpoint, delegate);
    }
}

// Public interface
#[contract_impl(contracttrait)]
impl OFTCore for MyOFT {}

// Internal logic (NO #[contract_impl] - keeps methods private)
impl OFTInternal for MyOFT {
    fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> OFTReceipt {
        mint_burn::debit::<Self>(env, sender, amount_ld, min_amount_ld, dst_eid)
    }

    fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128 {
        mint_burn::credit::<Self>(env, to, amount_ld, src_eid)
    }
}

// Receive handler
impl_oft_lz_receive!(MyOFT);
```

## Decimal handling

OFT uses "shared decimals" for cross-chain compatibility. Tokens are normalized to shared decimals when sent and converted back to local decimals when received.

```
Local decimals: 18 (e.g., Ethereum token)
Shared decimals: 6 (cross-chain standard)
Decimal conversion rate: 10^(18-6) = 10^12

Send: 1.5 tokens (1_500_000_000_000_000_000 local) → 1_500_000 shared
Receive: 1_500_000 shared → 1.5 tokens in local decimals
```

**Dust removal**: Amounts that can't be represented in shared decimals are "dust" and stay with the sender.

```rust
// Example: sending 1.5000001 tokens with 6 shared decimals
// amount_sent_ld: 1_500_000 (dust removed)
// amount_received_ld: 1_500_000
// dust (stays with sender): 1
```

## Sending tokens

```rust
// 1. Quote the transfer
let (limit, fee_details, receipt) = oft.quote_oft(&from, &send_param);

// 2. Quote LayerZero fees
let messaging_fee = oft.quote_send(&from, &send_param, false);

// 3. Execute the transfer
let (msg_receipt, oft_receipt) = oft.send(&from, &send_param, &messaging_fee, &refund_address);
```

### SendParam structure

```rust
SendParam {
    dst_eid: u32,           // Destination chain endpoint ID
    to: BytesN<32>,         // Recipient address (32 bytes)
    amount_ld: i128,        // Amount in local decimals
    min_amount_ld: i128,    // Minimum to receive (slippage protection)
    extra_options: Bytes,   // LayerZero execution options
    compose_msg: Bytes,     // Optional compose message
    oft_cmd: Bytes,         // Optional OFT command
}
```

## Receiving tokens

The `impl_oft_lz_receive!` macro handles receiving automatically:

1. Decodes the OFT message
2. Resolves the recipient address
3. Credits tokens via `__credit`
4. Optionally queues compose messages

For custom receive logic, implement `__receive` directly:

```rust
impl OFTInternal for MyOFT {
    fn __receive(
        env: &Env,
        origin: &Origin,
        guid: &BytesN<32>,
        message: &Bytes,
        extra_data: &Bytes,
        executor: &Address,
        value: i128,
    ) {
        // Custom validation
        validate_something(env);

        // Call default implementation
        <Self as OFTInternal>::__receive(env, origin, guid, message, extra_data, executor, value)
    }

    // ... __debit and __credit ...
}
```

## Extensions

### Pausable

Allows pausing all OFT operations:

```rust
use oft::pausable::{OFTPausable, OFTPausableInternal};

#[contract_impl(contracttrait)]
impl OFTPausable for MyOFT {}
impl OFTPausableInternal for MyOFT {}

// Override __debit_view or __credit to add pause check:
fn __credit(env: &Env, to: &Address, amount_ld: i128, src_eid: u32) -> i128 {
    Self::__assert_not_paused(env);  // Add this check
    mint_burn::credit::<Self>(env, to, amount_ld, src_eid)
}
```

Usage:

```rust
oft.set_paused(true);   // Pause (owner only)
oft.set_paused(false);  // Unpause (owner only)
oft.is_paused();        // Check status
```

### Fee collection

Collects fees on outbound transfers:

```rust
use oft::oft_fee::{OFTFee, OFTFeeInternal};

#[contract_impl(contracttrait)]
impl OFTFee for MyOFT {}
impl OFTFeeInternal for MyOFT {}

// Override __debit_view to apply fee:
fn __debit_view(env: &Env, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> OFTReceipt {
    let fee = Self::__get_fee(env, dst_eid, amount_ld);
    let amount_after_fee = amount_ld - fee;
    // ... rest of logic
}
```

Usage:

```rust
oft.set_default_fee_bps(100);              // 1% default fee (owner only)
oft.set_fee_bps(dst_eid, Some(50));        // 0.5% for specific destination
oft.set_fee_deposit(fee_addr);             // Where fees go
```

### Rate limiter

Limits transfer volume per time window:

```rust
use oft::rate_limiter::{Direction, RateLimiter, RateLimiterInternal, RateLimitConfig};

#[contract_impl(contracttrait)]
impl RateLimiter for MyOFT {}
impl RateLimiterInternal for MyOFT {}

// Call in __debit and __credit:
fn __debit(env: &Env, sender: &Address, amount_ld: i128, min_amount_ld: i128, dst_eid: u32) -> OFTReceipt {
    let receipt = mint_burn::debit::<Self>(env, sender, amount_ld, min_amount_ld, dst_eid);
    Self::__consume_rate_limit_capacity(env, &Direction::Outbound, dst_eid, receipt.amount_received_ld);
    receipt
}
```

Usage:

```rust
// Set rate limit: 1M tokens per hour for outbound to chain 30101
oft.set_rate_limit(
    &Direction::Outbound,
    30101,
    Some(RateLimitConfig { limit: 1_000_000_000_000, window_seconds: 3600 })
);

// Query capacity
let available = oft.rate_limit_capacity(&Direction::Outbound, 30101);
```

## SAC Manager

Wraps a Stellar Asset Contract (SAC) behind role-based admin so OFT MintBurn can mint without granting raw SAC admin authority to the OFT contract. Useful when the underlying token is a Stellar Classic Asset.

The SAC Manager:

- Becomes the admin of the underlying SAC
- Exposes a `mint` entry point that the OFT calls during credit
- Gates SAC admin operations (`mint`, `clawback`, `set_authorized`, `set_admin`) behind RBAC roles
- Inherits ownership and role management from `Ownable` and `RoleBasedAccessControl`

### Trust Model Requirement

**The issuer account must be locked (master weight set to 0).** In Stellar classic assets, transfers from/to the issuer are equivalent to minting/burning. The issuer can always mint more tokens and perform other classic operations directly, even when an explicit admin (this contract) is set. If the issuer account is not locked, the RBAC model enforced by this contract can be bypassed, breaking the trust model.

### Roles

Four roles guard the wrapped admin operations. Roles are passed as `Symbol` values to `grant_role`:

- `MINTER_ROLE`: authorizes `mint` (granted to the OFT contract for the credit path)
- `CLAWBACK_ROLE`: authorizes `clawback`
- `BLACKLISTER_ROLE`: authorizes `set_authorized`
- `ADMIN_MANAGER_ROLE`: authorizes `set_admin`

### Initialization

Deploy the SAC Manager and grant `MINTER_ROLE` to the OFT contract:

```rust
use soroban_sdk::{Env, Address, Symbol};

// Deploy the SAC Manager bound to the SAC and an owner
let manager = env.register(SACManager, (&sac_token, &owner));
let manager_client = SACManagerClient::new(&env, &manager);

// Grant MINTER_ROLE to the OFT contract so it can mint on credit
let minter_role = Symbol::new(&env, "MINTER_ROLE");
manager_client.grant_role(&oft_address, &minter_role, &owner);

// Make the manager the admin of the SAC
sac_client.set_admin(&manager);
```

### SAC admin operations

Each operation is gated by an `#[only_role(operator, ROLE)]` check. The `operator` argument must hold the role and authorize the call.

```rust
fn mint(env: &Env, to: &Address, amount: i128, operator: &Address);            // MINTER_ROLE
fn clawback(env: &Env, from: &Address, amount: i128, operator: &Address);      // CLAWBACK_ROLE
fn set_authorized(env: &Env, id: &Address, authorize: bool, operator: &Address); // BLACKLISTER_ROLE
fn set_admin(env: &Env, new_admin: &Address, operator: &Address);              // ADMIN_MANAGER_ROLE
```

`mint` and `clawback` proxy to the SAC's corresponding admin functions. `clawback` additionally requires the SAC issuer to have the `ClawbackEnabled` flag set; `set_authorized` requires the `Revocable` flag.

### Integrating with OFT MintBurn

1. Deploy the SAC and lock its issuer (master weight = 0).
2. Deploy the SAC Manager with the SAC address and owner.
3. Make the SAC Manager the admin of the SAC via `sac_client.set_admin(&manager)`.
4. Deploy the OFT in MintBurn mode, configured with the SAC as the token and the SAC Manager as the mint authority.
5. Grant `MINTER_ROLE` on the SAC Manager to the OFT contract address.

On send, the OFT burns directly on the SAC via SEP-41 `burn(sender, amount)` — this is signed by the sender and does not go through the SAC Manager. On receive, the OFT calls `manager.mint(to, amount, oft_address)`, which the SAC Manager forwards to the SAC.

### Ownership and role management

The SAC Manager inherits standard ownership and RBAC entry points:

- `owner`, `pending_owner`, `transfer_ownership`, `begin_ownership_transfer`, `accept_ownership`
- `grant_role`, `revoke_role`, `renounce_role`, `set_role_admin`, `remove_role_admin`

## Key traits summary

| Trait         | Purpose                   | Exposed |
| ------------- | ------------------------- | ------- |
| `OFTCore`     | Public transfer interface | Yes     |
| `OFTInternal` | Debit/credit logic        | No      |
| `OFTPausable` | Pause/unpause operations  | Yes     |
| `OFTFee`      | Fee configuration         | Yes     |
| `RateLimiter` | Rate limit configuration  | Yes     |
