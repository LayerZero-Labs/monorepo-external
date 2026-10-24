//! DVN interface

use lz_utils::bytes::Bytes32;
use starknet::ClassHash;
use starknet::account::Call;
use crate::workers::dvn::structs::{DstConfig, ExecuteParam, SetDstConfigParams};

/// Interface for the DVN contract
#[starknet::interface]
pub trait IDvn<TContractState> {
    // ================================== Only Admin =====================================

    /// Set the destination configurations for multiple EIDs
    ///
    /// # Arguments
    ///
    /// * `params` - Array of parameters for setting the destination configuration
    ///
    /// # Access Control
    ///
    /// * Only admins can call this function
    ///
    /// # Events
    ///
    /// * `DstConfigSet` - Emitted when the destination configuration is set
    fn set_dst_config(ref self: TContractState, params: Array<SetDstConfigParams>);

    /// Execute jobs
    ///
    /// # Arguments
    ///
    /// * `params` - Array of parameters for executing the jobs
    ///
    /// # Access Control
    ///
    /// * Only admins can call this function
    ///
    /// # Events
    ///
    /// * `VerifySignaturesFailed` - Emitted when the signatures verification fails
    /// * `HashAlreadyUsed` - Emitted when the hash is already used
    /// * `ExecuteFailed` - Emitted when the job execution fails
    fn execute(ref self: TContractState, params: Array<ExecuteParam>);

    // ================================== Only Quorum =====================================

    /// Function for quorum to change the admin without going through the execute function
    ///
    /// # Arguments
    ///
    /// * `param` - Parameter for changing the admin
    ///
    /// # Access Control
    ///
    /// * Anyone can call this function, but it will only succeed with a quorum of signatures
    ///
    /// # Events
    ///
    /// * `RoleGranted` - Emitted when the admin role is granted (from OpenZeppelin's
    /// [`AccessControlComponent`])
    fn quorum_change_admin(ref self: TContractState, param: ExecuteParam);

    // ================================== Only Self =====================================

    /// Upgrade the contract
    ///
    /// # Arguments
    ///
    /// * `new_class_hash` - The new class hash to upgrade to
    ///
    /// # Events
    ///
    /// * `Upgraded` - Emitted when the contract is upgraded (from OpenZeppelin's
    /// [`UpgradeableComponent`])
    ///
    /// @dev Only the contract itself can call this function (enforced by multisig)
    fn upgrade(ref self: TContractState, new_class_hash: ClassHash);

    /// Upgrade the contract and call a function
    ///
    /// # Arguments
    ///
    /// * `new_class_hash` - The new class hash to upgrade to
    /// * `selector` - The selector to call
    /// * `data` - The data to pass to the function
    ///
    /// # Returns
    ///
    /// * `Span<felt252>` - The response data from the function call
    ///
    /// # Events
    ///
    /// * `Upgraded` - Emitted when the contract is upgraded (from OpenZeppelin's
    /// [`UpgradeableComponent`])
    ///
    /// @dev Only the contract itself can call this function (enforced by multisig)
    fn upgrade_and_call(
        ref self: TContractState,
        new_class_hash: ClassHash,
        selector: felt252,
        calldata: Span<felt252>,
    ) -> Span<felt252>;

    // ================================== View ==========================================

    /// Get the destination configuration
    ///
    /// # Arguments
    ///
    /// * `dst_eid` - The destination EID
    ///
    /// # Returns
    ///
    /// * `DstConfig` - The destination configuration
    fn get_dst_config(self: @TContractState, dst_eid: u32) -> DstConfig;

    /// Get the Verifier ID, used to identify the verifier
    ///
    /// # Returns
    ///
    /// * `u32` - The VID
    fn get_vid(self: @TContractState) -> u32;

    /// Get the used hash
    ///
    /// # Arguments
    ///
    /// * `hash` - The hash
    fn get_used_hash(self: @TContractState, hash: Bytes32) -> bool;

    /// Hash the call data
    ///
    /// # Arguments
    ///
    /// * `vid` - The VID of the call data
    /// * `call_data` - The call data
    /// * `expiration` - The expiration of the call data
    ///
    /// # Returns
    ///
    /// * `Bytes32` - The keccak hash of the arguments
    fn hash_call_data(
        self: @TContractState, vid: u32, call_data: Call, expiration: u256,
    ) -> Bytes32;
}
