//! Executor interface

use starknet::{ClassHash, ContractAddress};
use crate::Origin;
use crate::workers::executor::structs::{
    ComposeParams, DstConfig, ExecuteParams, NativeDropParams, SetDstConfigParams,
};

/// Interface for the executor contract
#[starknet::interface]
pub trait IExecutor<TContractState> {
    // ================================== Only Default Admin ===============================

    /// Pause the contract
    fn pause(ref self: TContractState);

    /// Unpause the contract
    fn unpause(ref self: TContractState);

    /// Upgrades the contract
    ///
    /// # Arguments
    /// * `new_class_hash` - The new class hash to upgrade to
    ///
    /// # Events
    /// * `Upgraded` - Emitted when the contract is upgraded (from OpenZeppelin's
    /// [`UpgradeableComponent`])
    ///
    /// @dev This function is only callable by the owner.
    fn upgrade(ref self: TContractState, new_class_hash: ClassHash);

    /// Upgrades the contract and calls a function
    ///
    /// # Arguments
    /// * `new_class_hash` - The new class hash to upgrade to
    /// * `selector` - The selector to call
    /// * `data` - The data to pass to the function
    ///
    /// # Returns
    /// * `Span<felt252>` - The response data from the function call
    ///
    /// # Events
    /// * `Upgraded` - Emitted when the contract is upgraded (from OpenZeppelin's
    /// [`UpgradeableComponent`])
    ///
    /// @dev This function is only callable by the owner.
    fn upgrade_and_call(
        ref self: TContractState,
        new_class_hash: ClassHash,
        selector: felt252,
        calldata: Span<felt252>,
    ) -> Span<felt252>;

    // ================================== Only Admin =====================================

    /// Sets the destination configurations for one or more endpoint IDs.
    ///
    /// # Arguments
    /// * `params` - An array of `SetDstConfigParams` structs, each specifying a destination EID and
    /// its configuration.
    ///
    /// # Events
    /// * `DstConfigSet` - Emitted when the destination configurations are set.
    ///
    /// @dev This function is only callable by the admin.
    fn set_dst_config(ref self: TContractState, params: Array<SetDstConfigParams>);

    /// Execute a job
    ///
    /// # Arguments
    /// * `params` - The execution parameters
    ///
    /// # Events
    /// * `ExecuteFailed` - Emitted when the job execution fails
    ///
    /// @dev This function is only callable by the admin.
    fn execute(ref self: TContractState, params: ExecuteParams);

    /// Compose a message
    ///
    /// # Arguments
    /// * `params` - The composition parameters
    ///
    /// # Events
    /// * `ComposeFailed` - Emitted when the message composition fails
    ///
    /// @dev This function is only callable by the admin.
    fn compose(ref self: TContractState, params: ComposeParams);

    /// Drop native tokens to receivers.
    ///
    /// # Arguments
    /// * `origin` - The message origin
    /// * `oapp` - The OApp address
    /// * `native_drop_params` - The native drop parameters.
    ///
    /// # Events
    /// * `NativeDropFailed` - Emitted when the native drop fails
    ///
    /// @dev This function is only callable by the admin.
    fn native_drop(
        ref self: TContractState,
        origin: Origin,
        oapp: ContractAddress,
        native_drop_params: Array<NativeDropParams>,
    );

    /// Drop native tokens to receivers and execute a message.
    ///
    /// # Arguments
    /// * `native_drop_params` - The native drop parameters.
    /// * `execute_params` - The execution parameters.
    ///
    /// # Events
    /// * `NativeDropFailed` - Emitted when the native drop fails
    /// * `ExecuteFailed` - Emitted when the job execution fails
    ///
    /// @dev This function is only callable by the admin.
    fn native_drop_and_execute(
        ref self: TContractState,
        native_drop_params: Array<NativeDropParams>,
        execute_params: ExecuteParams,
    );

    // ================================== View ==========================================

    /// Get the destination configuration
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// * `DstConfig` - The destination configuration
    ///
    /// @dev This function is only callable by anyone.
    fn get_dst_config(self: @TContractState, dst_eid: u32) -> DstConfig;

    /// Get the endpoint address
    ///
    /// # Returns
    /// * `ContractAddress` - The endpoint address
    ///
    /// @dev This function is only callable by anyone.
    fn get_endpoint(self: @TContractState) -> ContractAddress;

    /// Get the native token address
    ///
    /// # Returns
    /// * `ContractAddress` - The native token address
    ///
    /// @dev This function is only callable by anyone.
    fn get_native_token_address(self: @TContractState) -> ContractAddress;

    /// Get the endpoint ID
    ///
    /// # Returns
    /// * `u32` - The endpoint ID
    ///
    /// @dev This function is only callable by anyone.
    fn get_eid(self: @TContractState) -> u32;
}
