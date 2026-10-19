//! Executor Fee Lib interface

use starknet::ContractAddress;
use crate::workers::executor::structs::DstConfig;

/// Fee parameters for executor fee calculation
#[derive(Drop, Clone, Serde)]
pub struct FeeParams {
    /// The address of the price feed contract
    pub price_feed: ContractAddress,
    /// The destination endpoint ID
    pub dst_eid: u32,
    /// The address of the sender
    pub sender: ContractAddress,
    /// The size of the calldata
    pub calldata_size: u32,
    /// The default multiplier basis points
    pub default_multiplier_bps: u16,
}

/// # Executor Fee Library Interface
///
/// This interface defines the standard functions for a LayerZero Executor Fee Library.
///
/// ## Key Responsibilities
/// 1.  **Fee Calculation:** Calculating the cost of message execution on a destination chain.
///     The fee is determined by factors such as the destination endpoint ID (EID), the size of the
///     message payload, and the gas price on the destination chain, which is obtained from a price
///     feed.
/// 2.  **Versioning:** Exposing its version number to allow for upgrades and compatibility checks.
///
/// The fee calculation can be performed in two ways:
/// - `get_fee`: A view function that returns the fee without any state changes. This is useful for
/// quoting.
/// - `get_fee_on_send`: An external function that calculates the fee and may perform state changes,
///   for example, to record fee-related data.
#[starknet::interface]
pub trait IExecutorFeeLib<TContractState> {
    // ================================== Only Owner =====================================

    /// Withdraws tokens from the fee library.
    /// Enables recovery of funds accidentally sent
    ///
    /// # Arguments
    /// * `token_address` - The address of the token to withdraw
    /// * `to` - The address to send the withdrawn tokens to
    /// * `amount` - The amount of tokens to withdraw
    fn withdraw_token(
        ref self: TContractState, token_address: ContractAddress, to: ContractAddress, amount: u256,
    );

    // ================================== External =====================================

    /// Gets the fee for sending a message, potentially changing state.
    ///
    /// # Arguments
    /// * `params` - The fee parameters
    /// * `dst_config` - The destination configuration
    /// * `options` - The message options
    ///
    /// # Returns
    /// * `u256` - The calculated fee
    fn get_fee_on_send(
        ref self: TContractState, params: FeeParams, dst_config: DstConfig, options: ByteArray,
    ) -> u256;

    // ================================== View =====================================

    /// Gets the fee for a message without changing state.
    ///
    /// # Arguments
    /// * `params` - The fee parameters
    /// * `dst_config` - The destination configuration
    /// * `options` - The message options
    ///
    /// # Returns
    /// * `u256` - The calculated fee
    fn get_fee(
        self: @TContractState, params: FeeParams, dst_config: DstConfig, options: ByteArray,
    ) -> u256;

    /// Gets the version of the fee library.
    ///
    /// # Returns
    /// * `(u64, u8)` - The major and minor version numbers
    fn version(self: @TContractState) -> (u64, u8);
}
