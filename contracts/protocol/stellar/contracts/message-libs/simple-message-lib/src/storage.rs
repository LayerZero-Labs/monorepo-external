use common_macros::storage;
use soroban_sdk::Address;

#[storage]
pub enum SmlStorage {
    #[instance(Address)]
    Endpoint,

    #[instance(u32)]
    LocalEid,

    #[instance(i128)]
    NativeFee,

    #[instance(i128)]
    ZroFee,

    #[instance(Address)]
    FeeRecipient,

    #[instance(Address)]
    WhitelistedCaller,
}
