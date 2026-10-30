//! Messaging composer events

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

/// Emitted when a compose message is sent.
#[derive(Drop, starknet::Event)]
pub struct ComposeSent {
    /// The sender of the compose message.
    #[key]
    pub from: ContractAddress,
    /// The recipient of the compose message.
    #[key]
    pub to: ContractAddress,
    /// The GUID of the original message.
    #[key]
    pub guid: Bytes32,
    /// The index of the compose message.
    pub index: u16,
    /// The message payload.
    pub message: ByteArray,
}

/// Emitted when a compose message is delivered.
#[derive(Drop, starknet::Event)]
pub struct ComposeDelivered {
    /// The sender of the compose message.
    #[key]
    pub from: ContractAddress,
    /// The recipient of the compose message.
    #[key]
    pub to: ContractAddress,
    /// The GUID of the original message.
    #[key]
    pub guid: Bytes32,
    /// The index of the compose message.
    pub index: u16,
}

/// Emitted when a compose message fails.
#[derive(Drop, starknet::Event)]
pub struct LzComposeAlert {
    /// The sender of the compose message.
    #[key]
    pub from: ContractAddress,
    /// The recipient of the compose message.
    #[key]
    pub to: ContractAddress,
    /// The address of the executor that triggered the alert.
    #[key]
    pub executor: ContractAddress,
    /// The GUID of the original message.
    #[key]
    pub guid: Bytes32,
    /// The index of the compose message.
    pub index: u16,
    /// The gas amount related to the alert.
    pub gas: u256,
    /// The value sent with the message.
    pub value: u256,
    /// The message payload.
    pub message: ByteArray,
    /// Extra data provided with the alert.
    pub extra_data: ByteArray,
    /// The reason for the alert.
    pub reason: Array<felt252>,
}
