use common_macros::storage;
use soroban_sdk::Address;

#[storage]
pub enum TreasuryStorage {
    /// Native fee in basis points (0-10000, where 10000 = 100%)
    #[instance(u32)]
    #[default(0)]
    NativeFeeBp,

    /// Global toggle for all fee collection
    #[instance(bool)]
    #[default(false)]
    FeeEnabled,

    /// Address of the ZRO token fee library contract for custom fee calculations
    #[instance(Address)]
    ZroFeeLib,
}
