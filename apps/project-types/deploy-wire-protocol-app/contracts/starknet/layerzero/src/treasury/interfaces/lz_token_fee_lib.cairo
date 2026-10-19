//! LayerZero token fee library interface

use starknet::ContractAddress;

/// Interface for LayerZero token fee library component.
///
/// LayerZero token fee library calculates treasury fees.
#[starknet::interface]
pub trait ILzTokenFeeLib<TContractState> {
    /// Calculates the treasury fee based on the worker fee.
    ///
    /// # Arguments
    /// * `sender` - The sender address
    /// * `dst_eid` - The destination endpoint ID
    /// * `worker_fee` - The total worker fee
    /// * `native_treasury_fee` - The treasury fee in native tokens
    ///
    /// # Returns
    /// * `u256` - The amount of tokens to be paid in LayerZero tokens
    fn get_fee(
        self: @TContractState,
        sender: ContractAddress,
        dst_eid: u32,
        worker_fee: u256,
        native_treasury_fee: u256,
    ) -> u256;

    /// Calculates the treasury fee based on the worker fee for later payment.
    ///
    /// # Arguments
    /// * `sender` - The sender address
    /// * `dst_eid` - The destination endpoint ID
    /// * `worker_fee` - The total worker fee
    /// * `native_treasury_fee` - The treasury fee in native tokens
    ///
    /// # Returns
    /// * `u256` - The amount of tokens to be paid in LayerZero tokens
    fn pay_fee(
        ref self: TContractState,
        sender: ContractAddress,
        dst_eid: u32,
        worker_fee: u256,
        native_treasury_fee: u256,
    ) -> u256;
}
