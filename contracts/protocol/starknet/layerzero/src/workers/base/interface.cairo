//! Base worker interface

use starknet::ContractAddress;

/// Interface for the base worker component
#[starknet::interface]
pub trait IWorkerBase<TContractState> {
    // ===================================== Only Admin =====================================

    /// Sets the price feed worker address
    ///
    /// # Arguments
    ///
    /// * `price_feed`: The address of the price feed worker
    ///
    /// @dev This function is only callable by the admin role.
    fn set_price_feed(ref self: TContractState, price_feed: ContractAddress);

    /// Sets the supported option type for an endpointID
    ///
    /// # Arguments
    ///
    /// * `eid`: The EID to set the supported option type for
    /// * `option_type`: The option type to set for the EID
    ///
    /// @dev This function is only callable by the admin role.
    fn set_supported_option_type(ref self: TContractState, eid: u32, option_type: ByteArray);

    /// Sets the default multiplier basis points
    ///
    /// # Arguments
    ///
    /// * `default_multiplier_bps`: The default multiplier basis points to set
    ///
    /// @dev This function is only callable by the admin role.
    fn set_default_multiplier_bps(ref self: TContractState, default_multiplier_bps: u16);

    /// Withdraw collected fees (only admin)
    fn withdraw_fee(
        ref self: TContractState, token_address: ContractAddress, to: ContractAddress, amount: u256,
    );

    /// Sets the worker fee lib address
    ///
    /// # Arguments
    ///
    /// * `worker_fee_lib`: The address of the worker fee lib
    ///
    /// @dev This function is only callable by the admin role.
    fn set_worker_fee_lib(ref self: TContractState, worker_fee_lib: ContractAddress);

    // ======================================= View ========================================

    /// Gets the current price feed address
    ///
    /// # Returns
    ///
    /// The current price feed worker's address
    fn get_price_feed(self: @TContractState) -> ContractAddress;

    /// Gets the supported option type for a given EID
    ///
    /// # Arguments
    ///
    /// * `eid`: The EID to get the supported option type for
    ///
    /// # Returns
    ///
    /// The supported option type for the EID
    fn get_supported_option_type(self: @TContractState, eid: u32) -> ByteArray;

    /// Gets the default multiplier basis points
    ///
    /// # Returns
    ///
    /// The default multiplier basis points
    fn get_default_multiplier_bps(self: @TContractState) -> u16;

    /// Gets the current worker fee lib address
    ///
    /// # Returns
    ///
    /// The current worker fee lib address
    fn get_worker_fee_lib(self: @TContractState) -> ContractAddress;

    /// Gets the allow list size
    ///
    /// # Returns
    ///
    /// The allow list size
    fn get_allow_list_size(self: @TContractState) -> u64;

    /// Checks if the sender is allowed by allow list and deny list
    ///
    /// # Arguments
    ///
    /// * `sender`: The address of the sender
    ///
    /// # Returns
    ///
    /// True if the sender is allowed by allow list and deny list, false otherwise
    fn is_sender_allowed(self: @TContractState, sender: ContractAddress) -> bool;
}
