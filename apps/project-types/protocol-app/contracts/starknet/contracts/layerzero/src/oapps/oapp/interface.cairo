use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::Origin;

#[starknet::interface]
pub trait IOApp<TContractState> {
    /// Gets the LayerZero endpoint contract address
    ///
    /// # Returns
    ///
    /// The contract address of the LayerZero endpoint
    fn get_endpoint(self: @TContractState) -> ContractAddress;

    /// Sets a peer for a specific endpoint ID
    /// This establishes a trusted connection to another OApp on a different chain
    ///
    /// # Arguments
    ///
    /// * `eid`: The endpoint ID of the destination chain
    /// * `peer`: The peer address as a 32-byte value
    fn set_peer(ref self: TContractState, eid: u32, peer: Bytes32);

    /// Gets the peer address for a specific endpoint ID
    ///
    /// # Arguments
    ///
    /// * `eid`: The endpoint ID of the destination chain
    ///
    /// # Returns
    ///
    /// The peer address as a 32-byte value
    fn get_peer(self: @TContractState, eid: u32) -> Bytes32;

    /// Returns the OApp version information
    ///
    /// # Returns
    ///
    /// A tuple containing (sender_version, receiver_version) as u64 values
    fn oapp_version(self: @TContractState) -> (u64, u64);

    /// Sets the send library for a specific endpoint ID
    ///
    /// # Arguments
    ///
    /// * `dst_eid`: The destination endpoint ID
    /// * `delegate`: The contract address of the delegate
    fn set_delegate(ref self: TContractState, delegate: ContractAddress);
}

#[starknet::interface]
pub trait IOAppReceiver<TContractState> {
    /// Verifies if a sender is authorized for compose message operations
    /// This is used in message composition scenarios to validate senders
    ///
    /// # Arguments
    ///
    /// * `origin`: The origin information of the message
    /// * `message`: The message content to validate
    /// * `sender`: The contract address claiming to be the sender
    ///
    /// # Returns
    ///
    /// True if the sender is authorized for compose messages, false otherwise
    fn is_compose_msg_sender(
        self: @TContractState, origin: Origin, message: ByteArray, sender: ContractAddress,
    ) -> bool;
}
