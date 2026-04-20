use common_macros::storage;
use soroban_sdk::{Address, Bytes, Vec};

/// Storage keys for the Worker contract.
#[storage]
pub enum WorkerStorage {
    /// Whether the worker is paused (prevents new job assignments).
    #[instance(bool)]
    #[default(false)]
    Paused,

    /// Admin addresses with configuration permissions.
    ///
    /// Admins can modify worker settings but cannot change ownership.
    #[persistent(Vec<Address>)]
    #[default(Vec::new(env))]
    Admins,

    /// List of supported message library addresses (e.g., ULN302).
    #[persistent(Vec<Address>)]
    #[default(Vec::new(env))]
    MessageLibs,

    /// Allowlist status for an OApp address.
    ///
    /// When allowlist is empty, all non-denylisted OApps are allowed.
    #[persistent(bool)]
    Allowlist { oapp: Address },

    /// Counter for the number of addresses on the allowlist.
    ///
    /// Used to efficiently check if allowlist is empty (empty = allow all non-denylisted).
    #[instance(u32)]
    #[default(0)]
    AllowlistSize,

    /// Denylist status for an OApp address.
    ///
    /// Denylisted OApps are blocked regardless of allowlist status.
    #[persistent(bool)]
    Denylist { oapp: Address },

    /// Default fee multiplier in basis points (10000 = 1x).
    #[instance(u32)]
    #[default(0)]
    DefaultMultiplierBps,

    /// Address where worker fees are collected.
    #[instance(Address)]
    DepositAddress,

    /// Supported executor option types for a destination endpoint.
    ///
    /// Since Stellar does not support Vec<u8>, we use Bytes instead where each byte
    /// represents an option type (lzReceive, lzCompose, nativeDrop, etc.).
    #[persistent(Bytes)]
    SupportedOptionTypes { eid: u32 },

    /// Worker fee library contract address for fee calculation logic.
    #[instance(Address)]
    WorkerFeeLib,

    /// Price feed contract address for cross-chain fee calculations.
    #[instance(Address)]
    PriceFeed,
}
