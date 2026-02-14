//! Messaging channel interface

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::common::structs::packet::Origin;

/// # `IMessagingChannel` Interface
///
/// The `IMessagingChannel` interface is responsible for nonce management and message verification
/// for LayerZero cross-chain messaging. It ensures ordered execution and provides mechanisms for
/// skipping, nilifying, and burning messages as needed.
#[starknet::interface]
pub trait IMessagingChannel<TContractState> {
    /// Returns the max index of the longest gapless sequence of verified message nonces
    ///
    /// The uninitialized value is 0. The first nonce is always 1.
    /// Starts from lazy_inbound_nonce and iteratively checks if the next nonce has been verified.
    /// NOTE: OApp explicitly skipped nonces count as "verified" for these purposes.
    /// Example: [1,2,3,4,6,7] => 4, [1,2,6,8,10] => 2, [1,3,4,5,6] => 1
    ///
    /// # Arguments
    ///
    /// * `receiver`: The receiver contract address
    /// * `src_eid`: The source endpoint ID
    /// * `sender`: The sender address from the source chain
    ///
    /// # Returns
    ///
    /// * `u64`: The highest consecutively verified nonce
    ///
    /// # Panics
    /// * If too many backlogs exist and the function runs out of gas (can be fixed by clearing
    /// prior messages)
    fn inbound_nonce(
        self: @TContractState, receiver: ContractAddress, src_eid: u32, sender: Bytes32,
    ) -> u64;

    /// Returns the current outbound nonce for a specific path
    ///
    /// Used to track the number of messages sent on a specific path.
    /// Incremented each time a message is sent through the endpoint.
    ///
    /// # Arguments
    ///
    /// * `sender`: The sender contract address
    /// * `dst_eid`: The destination endpoint ID
    /// * `receiver`: The receiver address on the destination chain
    ///
    /// # Returns
    ///
    /// * `u64`: The current outbound nonce for this path
    fn outbound_nonce(
        self: @TContractState, sender: ContractAddress, dst_eid: u32, receiver: Bytes32,
    ) -> u64;

    /// Returns the stored payload hash for a specific message
    ///
    /// Returns EMPTY_PAYLOAD_HASH (0) if the message has been executed.
    /// Returns NIL_PAYLOAD_HASH (bytes32.max) if the message has been nilified.
    /// Returns the actual payload hash if the message is verified but not executed.
    ///
    /// # Arguments
    ///
    /// * `receiver`: The receiver contract address
    /// * `src_eid`: The source endpoint ID
    /// * `sender`: The sender address from the source chain
    /// * `nonce`: The message nonce
    ///
    /// # Returns
    ///
    /// * `Bytes32`: The payload hash for the specified message
    fn inbound_payload_hash(
        self: @TContractState, receiver: ContractAddress, src_eid: u32, sender: Bytes32, nonce: u64,
    ) -> Bytes32;

    /// Returns the lazy inbound nonce (last checkpoint) for a specific path
    ///
    /// This is the last nonce that was processed (executed or skipped).
    /// Used as a starting point for calculating the effective inbound nonce.
    /// Updated lazily when messages are executed or explicitly skipped.
    ///
    /// # Arguments
    ///
    /// * `receiver`: The receiver contract address
    /// * `src_eid`: The source endpoint ID
    /// * `sender`: The sender address from the source chain
    ///
    /// # Returns
    ///
    /// * `u64`: The lazy inbound nonce representing the last processed checkpoint
    fn lazy_inbound_nonce(
        self: @TContractState, receiver: ContractAddress, src_eid: u32, sender: Bytes32,
    ) -> u64;

    /// Skips the next expected nonce to prevent message verification
    ///
    /// Usage: Skip messages when Precrime throws alerts or other security concerns arise.
    /// After skipping, the lazy_inbound_nonce is set to the provided nonce.
    /// This allows the Receiver to increment the lazy_inbound_nonce without verification.
    ///
    /// # Arguments
    ///
    /// * `origin`: The origin of the message
    ///
    /// # Panics
    /// * If the provided nonce is not exactly the next expected nonce
    /// * If a race condition occurs (e.g. trying to skip nonce 3 but nonce 3 was consumed
    /// first)
    fn skip(ref self: TContractState, receiver: ContractAddress, origin: Origin);

    /// Marks a packet as verified but disallows execution until it is re-verified
    ///
    /// A non-verified nonce can be nilified by passing EMPTY_PAYLOAD_HASH for payload_hash.
    /// Assumes computational intractability of finding a payload that hashes to bytes32.max.
    /// Sets the payload hash to NIL_PAYLOAD_HASH to prevent execution while keeping
    /// verification.
    ///
    /// # Arguments
    ///
    /// * `receiver`: The receiver contract address
    /// * `src_eid`: The source endpoint ID where the message originated
    /// * `sender`: The sender address from the source chain
    /// * `nonce`: The nonce of the message to nilify
    /// * `payload_hash`: The expected payload hash that must match the stored hash
    ///
    /// # Panics
    /// * If the provided payload_hash does not match the currently verified payload hash
    /// * If the nonce is greater than the lazy inbound nonce
    /// * If the nonce has already been executed (payload hash is EMPTY_PAYLOAD_HASH)
    fn nilify(
        ref self: TContractState, receiver: ContractAddress, origin: Origin, payload_hash: Bytes32,
    );


    /// Marks a nonce as unexecutable and un-verifiable permanently
    ///
    /// The nonce can never be re-verified or executed after burning.
    ///
    /// # Arguments
    ///
    /// * `origin`: The origin of the message
    /// * `origin`: The origin of the message, including the nonce to burn
    /// * `payload_hash`: The expected payload hash that must match the stored hash
    ///
    /// # Panics
    /// * If the provided payload_hash does not match the currently verified payload hash
    /// * If the nonce is greater than the lazy inbound nonce
    /// * If the nonce has already been executed (payload hash is EMPTY_PAYLOAD_HASH)
    fn burn(
        ref self: TContractState, receiver: ContractAddress, origin: Origin, payload_hash: Bytes32,
    );


    /// Returns the GUID for the next message given the path
    ///
    /// The OApp might want to include the GUID into the message in some cases.
    /// Uses the next outbound nonce to generate a unique identifier.
    ///
    /// # Arguments
    ///
    /// * `sender`: The sender contract address
    /// * `dst_eid`: The destination endpoint ID
    /// * `receiver`: The receiver address on the destination chain
    ///
    /// # Returns
    ///
    /// * `Bytes32`: The globally unique identifier for the next message
    fn next_guid(
        self: @TContractState, sender: ContractAddress, dst_eid: u32, receiver: Bytes32,
    ) -> Bytes32;
}
