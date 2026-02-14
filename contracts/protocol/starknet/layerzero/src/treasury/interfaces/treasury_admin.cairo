//! Treasury admin interface

use starknet::ContractAddress;

/// Interface for TreasuryAdmin component
///
/// The TreasuryAdmin allows administrators of the treasury to manage the treasury
/// fee configuration, and withdraw collected fees.
#[starknet::interface]
pub trait ITreasuryAdmin<TContractState> {
    /// Gets the basis points of the treasury fee.
    ///
    /// # Returns
    /// * `u256` - The basis points
    fn get_fee_bp(self: @TContractState) -> u256;

    /// Sets the basis points of the treasury fee.
    ///
    /// # Arguments
    /// * `basis_points` - The basis points
    fn set_fee_bp(ref self: TContractState, basis_points: u256);

    /// Withdraws the collected fee of a given token address.
    fn withdraw_tokens(
        ref self: TContractState, token_address: ContractAddress, to: ContractAddress, amount: u256,
    );

    /// Gets the LZ token fee library.
    ///
    /// # Returns
    /// * `Option<ContractAddress>` - The LZ token fee library if any
    fn get_lz_token_fee_lib(self: @TContractState) -> Option<ContractAddress>;

    /// Sets the LZ token fee library.
    ///
    /// # Arguments
    /// * `library` - The LZ token fee library
    fn set_lz_token_fee_lib(ref self: TContractState, library: Option<ContractAddress>);
}
