//! LayerZero treasury interface

use starknet::ContractAddress;

/// Interface for Treasury component
///
/// The Treasury collects treasury fees.
#[starknet::interface]
pub trait ILayerZeroTreasury<TContractState> {
    /// Calculates the treasury fee based on the worker fee and whether the fee should be paid in
    /// LZ tokens. If the fee should be paid in LZ tokens, the fee is returned in ZRO, or otherwise
    /// in native tokens.
    ///
    /// # Arguments
    /// * `sender` - The sender address
    /// * `dst_eid` - The destination endpoint ID
    /// * `worker_fee` - The total worker fee
    /// * `pay_in_lz_token` - The flag indicating whether a fee is paid in LZ tokens or not
    ///
    /// # Returns
    /// * `u256` - The amount of tokens to be paid
    ///
    /// # Panics
    /// * If `pay_in_lz_token` is true while LZ token payment is disabled in the treasury
    fn get_fee(
        self: @TContractState,
        sender: ContractAddress,
        dst_eid: u32,
        worker_fee: u256,
        pay_in_lz_token: bool,
    ) -> u256;

    /// Pays the fee to the treasury. The fee is calculated based on the worker fee and whether the
    /// fee should be paid in LZ tokens.
    ///
    /// # Arguments
    /// * `sender` - The sender address
    /// * `dst_eid` - The destination endpoint ID
    /// * `worker_fee` - The total worker fee
    /// * `pay_in_lz_token` - The flag indicating whether a fee is paid in LZ tokens or not
    ///
    /// # Returns
    /// * `u256` - The amount of tokens to be paid
    ///
    /// # Panics
    /// * If `pay_in_lz_token` is true while LZ token payment is disabled in the treasury
    fn pay_fee(
        ref self: TContractState,
        sender: ContractAddress,
        dst_eid: u32,
        worker_fee: u256,
        pay_in_lz_token: bool,
    ) -> u256;
}
