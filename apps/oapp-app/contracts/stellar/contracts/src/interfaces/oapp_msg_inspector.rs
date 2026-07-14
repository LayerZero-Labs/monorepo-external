//! OApp Message Inspector interface.
//!
//! This module defines the `IOAppMsgInspector` trait that external inspector contracts
//! must implement to validate outgoing LayerZero messages and options.
//!
//! Implementations can signal failure in two ways:
//! - Return `false` to indicate the inspection failed.
//! - Panic directly to abort the transaction immediately.
//!
//! ## Usage
//!
//! ### Returning a boolean
//!
//! ```ignore
//! use oapp::interfaces::IOAppMsgInspector;
//!
//! pub struct MyInspector;
//!
//! #[contractimpl]
//! impl IOAppMsgInspector for MyInspector {
//!     fn inspect(env: &Env, oapp: &Address, message: &Bytes, options: &Bytes) -> bool {
//!         is_valid(message, options)
//!     }
//! }
//! ```
//!
//! ### Panicking on failure
//!
//! ```ignore
//! use oapp::interfaces::IOAppMsgInspector;
//!
//! pub struct MyInspector;
//!
//! #[contractimpl]
//! impl IOAppMsgInspector for MyInspector {
//!     fn inspect(env: &Env, oapp: &Address, message: &Bytes, options: &Bytes) -> bool {
//!         if !is_valid(message, options) {
//!             panic_with_error!(env, MyError::InspectionFailed);
//!         }
//!         true
//!     }
//! }
//! ```

use soroban_sdk::{contractclient, Address, Bytes, Env};

/// Interface for OApp message inspectors.
///
/// Contracts implementing this trait can be set as message inspectors on OFT contracts
/// to validate outgoing messages and options before they are sent cross-chain.
///
/// Implementations may either return `false` to indicate failure, or panic directly
/// to abort the transaction.
#[contractclient(name = "OAppMsgInspectorClient")]
pub trait IOAppMsgInspector {
    /// Allows the inspector to examine LayerZero message contents and determine their validity.
    ///
    /// # Arguments
    /// * `oapp` - The address of the OApp contract sending the message
    /// * `message` - The message payload to be inspected.
    /// * `options` - Additional LayerZero options for inspection.
    ///
    /// # Returns
    /// * `bool` - `true` if the inspection passed, `false` if the message or options are invalid.
    ///
    /// # Panics
    /// Implementations may choose to panic instead of returning `false` to abort the
    /// transaction immediately with a specific error.
    fn inspect(env: &Env, oapp: &Address, message: &Bytes, options: &Bytes) -> bool;
}
