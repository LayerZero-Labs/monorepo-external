//! Storage definitions for LayerZero view contracts.

use common_macros::storage;
use soroban_sdk::Address;

/// Storage keys for LayerZeroView contract.
#[storage]
pub enum LayerZeroViewStorage {
    /// The LayerZero endpoint address.
    #[instance(Address)]
    Endpoint,
    /// The Uln302 contract address.
    #[instance(Address)]
    Uln302,
    /// The local endpoint ID (cached for efficiency).
    #[instance(u32)]
    LocalEid,
}
