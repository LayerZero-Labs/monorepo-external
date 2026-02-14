//! LayerZero receiver interface

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::common::structs::packet::Origin;

/// # `ILayerZeroReceiver` Interface
///
/// The `ILayerZeroReceiver` interface is responsible for receiving and processing LayerZero
/// messages from other chains.
/// It provides a function for handling the received message and executing the payload.
///
/// ## Key Features
/// - **Message Receiving**: Receives and processes LayerZero messages from other chains.
/// - **Execution**: Executes the received message payload.
/// - **Security**: Ensures that only valid messages are processed.
#[starknet::interface]
pub trait ILayerZeroReceiver<TContractState> {
    /// Receives and processes LayerZero messages from other chains
    /// This is the main entry point for incoming cross-chain messages
    ///
    /// # Arguments
    ///
    /// * `origin`: The origin information containing source endpoint ID and sender
    /// * `guid`: Globally unique identifier for this message
    /// * `message`: The actual message payload as bytes
    /// * `executor`: The contract address of the executor handling this message
    /// * `extra_data`: Additional data that may be used for message processing. Note that this data
    ///                 is passed from the executor directly, and not verified by DVNs. It needs to
    ///                 be validated manually.
    /// * `value`: The value sent with the message
    fn lz_receive(
        ref self: TContractState,
        origin: Origin,
        guid: Bytes32,
        message: ByteArray,
        executor: ContractAddress,
        extra_data: ByteArray,
        value: u256,
    );

    /// Checks if a path can be initialized for the given origin
    /// This is used to determine if a new communication path should be allowed
    ///
    /// # Arguments
    ///
    /// * `origin`: The origin information to check for path initialization
    ///
    /// # Returns
    ///
    /// True if the path can be initialized, false otherwise
    fn allow_initialize_path(self: @TContractState, origin: Origin) -> bool;

    /// Gets the next nonce value for a specific source endpoint and sender
    /// Nonces are used to ensure message ordering and prevent replay attacks
    ///
    /// # Arguments
    ///
    /// * `src_eid`: The source endpoint ID
    /// * `sender`: The sender address as a 32-byte value
    ///
    /// # Returns
    ///
    /// The next nonce value as a u64
    fn next_nonce(self: @TContractState, src_eid: u32, sender: Bytes32) -> u64;
}
