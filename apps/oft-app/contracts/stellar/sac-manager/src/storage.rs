//! Storage definitions for the SAC manager contract.
//!
//! This file contains the core storage.

use common_macros::storage;
use soroban_sdk::Address;

#[storage]
pub enum SACManagerStorage {
    /// The underlying SAC (Stellar Asset Contract) address
    #[instance(Address)]
    SacToken,
}
