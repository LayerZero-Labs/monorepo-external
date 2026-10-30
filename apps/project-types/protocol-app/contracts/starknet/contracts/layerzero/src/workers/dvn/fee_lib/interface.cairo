//! DVN Fee Lib interface

use starknet::ContractAddress;
use crate::workers::dvn::structs::DstConfig;

/// Fee parameters for DVN fee calculation
#[derive(Drop, Clone, Serde)]
pub struct FeeParams {
    pub price_feed: ContractAddress,
    pub dst_eid: u32,
    pub confirmations: u64,
    pub sender: ContractAddress,
    pub quorum: u32,
    pub default_multiplier_bps: u16,
}

/// Interface for DVN Fee Library
#[starknet::interface]
pub trait IDvnFeeLib<TContractState> {
    // ================================== Only Owner =====================================

    /// Withdraw tokens from the fee lib
    /// Enables recovery of funds accidentally sent
    fn withdraw_token(
        ref self: TContractState, token_address: ContractAddress, to: ContractAddress, amount: u256,
    );

    // ================================== External =====================================

    /// Get fee function that can change state (e.g. paying price feed)
    fn get_fee_on_send(
        ref self: TContractState, params: FeeParams, dst_config: DstConfig, options: ByteArray,
    ) -> u256;

    // ================================== View =====================================

    /// Get fee view function
    fn get_fee(
        self: @TContractState, params: FeeParams, dst_config: DstConfig, options: ByteArray,
    ) -> u256;

    /// Get version
    /// Returns (major, minor)
    fn version(self: @TContractState) -> (u64, u8);
}
