use common_macros::storage;
use soroban_sdk::{contracttype, Address, Vec, Symbol};

use crate::DstConfig;

/// Configuration for a registered executor helper contract.
///
/// Stores the helper contract address and the set of function names
/// that the executor is allowed to authorize calls through.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutorHelperConfig {
    /// The executor helper contract address.
    pub address: Address,
    /// Allowed function names on the helper (e.g., "execute", "compose").
    pub allowed_functions: Vec<Symbol>,
}

/// Storage keys for the Executor contract.
///
/// Manages persistent storage for destination configurations and instance storage
/// for the endpoint address.
#[storage]
pub enum ExecutorStorage {
    /// Destination chain configuration indexed by endpoint ID.
    ///
    /// Stores `DstConfig` for each destination endpoint, containing gas costs,
    /// fee multipliers, and native caps.
    #[persistent(DstConfig)]
    DstConfig { eid: u32 },

    /// LayerZero Endpoint V2 contract address.
    ///
    /// Used for receive-flow operations to interact with the endpoint.
    #[instance(Address)]
    Endpoint,

    /// Executor helper configuration (address + allowed function names).
    ///
    /// Used by `validate_auth_contexts` to verify that auth contexts
    /// originate from a registered helper contract with permitted functions.
    #[instance(ExecutorHelperConfig)]
    ExecutorHelper,
}
