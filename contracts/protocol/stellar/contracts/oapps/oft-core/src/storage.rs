use common_macros::storage;
use soroban_sdk::Address;

#[storage]
pub enum OFTStorage {
    /// The difference between local and shared decimals (local_decimals - shared_decimals).
    /// Immutable: set once during construction and never modified.
    #[instance(u32)]
    DecimalsDiff,

    /// The address of the underlying token contract.
    /// Immutable: set once during construction and never modified.
    #[instance(Address)]
    Token,

    /// The optional message inspector contract address
    #[instance(Address)]
    MsgInspector,
}
