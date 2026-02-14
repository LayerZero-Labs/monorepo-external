//! Base worker events

use starknet::ContractAddress;

/// Event emitted when the price feed address is updated
#[derive(Drop, starknet::Event)]
pub struct PriceFeedSet {
    #[key]
    pub old_price_feed: ContractAddress,
    #[key]
    pub new_price_feed: ContractAddress,
}

/// Event emitted when fees are withdrawn
#[derive(Drop, starknet::Event)]
pub struct FeeWithdrawn {
    #[key]
    pub to: ContractAddress,
    pub amount: u256,
}

/// Event emitted when the supported option type for an EID is set
#[derive(Drop, starknet::Event)]
pub struct SupportedOptionTypeSet {
    #[key]
    pub eid: u32,
    pub option_type: ByteArray,
}

/// Event emitted when the default multiplier basis points is set
#[derive(Drop, starknet::Event)]
pub struct DefaultMultiplierBpsSet {
    pub default_multiplier_bps: u16,
}

/// Event emitted when the worker fee lib address is updated
#[derive(Drop, starknet::Event)]
pub struct WorkerFeeLibSet {
    #[key]
    pub old_worker_fee_lib: ContractAddress,
    #[key]
    pub new_worker_fee_lib: ContractAddress,
}
