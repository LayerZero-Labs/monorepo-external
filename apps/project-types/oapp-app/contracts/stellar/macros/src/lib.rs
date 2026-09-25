//! # OApp Procedural Macros
//!
//! This crate provides the `#[oapp]` procedural macro for implementing LayerZero OApp
//! (Omnichain Application) functionality on Soroban smart contracts.
//!
//! ## Overview
//!
//! The OApp framework provides full bidirectional cross-chain communication:
//!
//! - **OAppCore**: Foundation for all OApp functionality (peer management, endpoint access)
//! - **OAppSenderInternal**: Enables sending cross-chain messages through LayerZero
//! - **LzReceiveInternal**: Internal trait for message handling logic
//! - **OAppReceiver**: Handles incoming cross-chain messages (has default `lz_receive` impl)
//! - **OAppOptionsType3**: Manages enforced options for message execution parameters
//!
//! ## Usage
//!
//! ### `#[oapp]`
//! The main macro that provides Core + Sender + Receiver + OptionsType3 functionality.
//! This is the only macro you need for cross-chain communication.
//!
//! ### Custom Implementations
//!
//! By default, `#[oapp]` generates default trait implementations. Use `#[oapp(custom = [...])]`
//! to provide your own custom implementations for specific traits:
//!
//! Supported options:
//! - `core` - Custom implement `OAppCore`
//! - `sender` - Custom implement `OAppSenderInternal`
//! - `receiver` - Custom implement `OAppReceiver` (useful for custom `next_nonce`, etc.)
//! - `options_type3` - Custom implement `OAppOptionsType3`
//!
//! ## Examples
//!
//! ### Full OApp with Default Implementations
//!
//! ```ignore
//! use oapp::oapp_receiver::LzReceiveInternal;
//! use oapp_macros::oapp;
//!
//! #[oapp]
//! #[common_macros::lz_contract]
//! struct MyOApp;
//!
//! // Implement LzReceiveInternal to handle incoming messages
//! impl LzReceiveInternal for MyOApp {
//!     fn __lz_receive(
//!         env: &Env,
//!         origin: &Origin,
//!         guid: &BytesN<32>,
//!         message: &Bytes,
//!         extra_data: &Bytes,
//!         executor: &Address,
//!         value: i128,
//!     ) {
//!         // Your message handling logic (clear_payload_and_transfer already called)
//!     }
//! }
//! ```
//!
//! ### OApp with Custom Core Version
//!
//! ```ignore
//! use oapp::oapp_receiver::LzReceiveInternal;
//! use utils::rbac::RoleBasedAccessControl;
//!
//! #[oapp(custom = [core])]
//! #[common_macros::lz_contract]
//! struct MyOApp;
//!
//! // Required: `custom = [core]` skips generating both OAppCore and RoleBasedAccessControl impls
//! impl RoleBasedAccessControl for MyOApp {}
//!
//! #[contractimpl(contracttrait)]
//! impl OAppCore for MyOApp {
//!     fn oapp_version(_env: &Env) -> (u64, u64) {
//!         (1, 1) // Custom version
//!     }
//! }
//!
//! impl LzReceiveInternal for MyOApp {
//!     fn __lz_receive(...) { /* ... */ }
//! }
//! ```
//!
//! ### OApp with Custom Receiver (e.g., ordered delivery)
//!
//! ```ignore
//! use oapp::oapp_receiver::{LzReceiveInternal, OAppReceiver};
//!
//! #[oapp(custom = [receiver])]
//! #[common_macros::lz_contract]
//! struct MyOrderedOApp;
//!
//! impl LzReceiveInternal for MyOrderedOApp {
//!     fn __lz_receive(env: &Env, origin: &Origin, guid: &BytesN<32>, ...) {
//!         // Your message handling logic
//!     }
//! }
//!
//! #[contractimpl(contracttrait)]
//! impl OAppReceiver for MyOrderedOApp {
//!     fn next_nonce(env: &Env, src_eid: u32, sender: &BytesN<32>) -> u64 {
//!         // Custom nonce logic for ordered delivery
//!         Storage::max_received_nonce(env, src_eid, sender) + 1
//!     }
//!     // lz_receive uses default impl which calls clear_payload_and_transfer then __lz_receive
//! }
//! ```
//!
//! ### OApp with Multiple Custom Implementations
//!
//! ```ignore
//! use oapp::oapp_receiver::LzReceiveInternal;
//! use utils::rbac::RoleBasedAccessControl;
//!
//! #[oapp(custom = [core, sender, options_type3])]
//! #[common_macros::lz_contract]
//! struct MyCustomOApp;
//!
//! // Required: `custom = [core]` skips generating both OAppCore and RoleBasedAccessControl impls
//! impl RoleBasedAccessControl for MyCustomOApp {}
//!
//! #[contractimpl(contracttrait)]
//! impl OAppCore for MyCustomOApp { /* ... */ }
//! impl OAppSenderInternal for MyCustomOApp { /* ... */ }
//! #[contractimpl(contracttrait)]
//! impl OAppOptionsType3 for MyCustomOApp { /* ... */ }
//!
//! impl LzReceiveInternal for MyCustomOApp {
//!     fn __lz_receive(...) { /* ... */ }
//! }
//! ```

mod generators;

use proc_macro::TokenStream;

/// Derives OApp trait implementations. Apply `#[lz_contract]` (or similar) for contract + TTL + Auth.
///
/// ## Usage
///
/// ```ignore
/// // Default: generates all trait implementations
/// #[oapp]
/// struct MyOApp;
///
/// // Provide custom implementations for specific traits
/// #[oapp(custom = [core, receiver])]
/// struct MyCustomOApp;
/// ```
///
/// ## Custom Options
/// - `core` - Manually implement `OAppCore`
/// - `sender` - Manually implement `OAppSenderInternal`
/// - `receiver` - Manually implement `OAppReceiver`
/// - `options_type3` - Manually implement `OAppOptionsType3`
///
/// You must implement `LzReceiveInternal` for your struct. See module docs for examples.
#[proc_macro_attribute]
pub fn oapp(attr: TokenStream, item: TokenStream) -> TokenStream {
    generators::generate_oapp(attr.into(), item.into()).into()
}

#[cfg(test)]
mod tests;
