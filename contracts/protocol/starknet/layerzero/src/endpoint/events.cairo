//! EndpointV2 events

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::common::structs::packet::Origin;

/// Emitted when a packet is sent from the EndpointV2.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct PacketSent {
    /// The encoded packet data.
    pub encoded_packet: ByteArray,
    /// The options specified for the message.
    pub options: ByteArray,
    /// The address of the send library used.
    #[key]
    pub send_library: ContractAddress,
}

/// Emitted when a packet is verified and the payload hash is stored.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct PacketVerified {
    /// The origin of the packet.
    #[key]
    pub origin: Origin,
    /// The intended receiver of the packet.
    #[key]
    pub receiver: ContractAddress,
    /// The hash of the packet's payload.
    #[key]
    pub payload_hash: Bytes32,
}

/// Emitted when a packet is successfully delivered to the receiver.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct PacketDelivered {
    /// The origin of the packet.
    #[key]
    pub origin: Origin,
    /// The receiver of the packet.
    #[key]
    pub receiver: ContractAddress,
}

/// Emitted when a receive message fails.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct LzReceiveAlert {
    /// The origin of the message.
    #[key]
    pub origin: Origin,
    /// The intended receiver of the message.
    #[key]
    pub receiver: ContractAddress,
    /// The address of the executor that triggered the alert.
    #[key]
    pub executor: ContractAddress,
    /// The GUID of the message.
    #[key]
    pub guid: Bytes32,
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

/// Emitted when the LZ token address is set.
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct LzTokenSet {
    /// The new address of the LZ token.
    #[key]
    pub lz_token_address: ContractAddress,
}

/// Emitted when a delegate is set for an OApp.
#[derive(Drop, starknet::Event)]
pub struct DelegateSet {
    /// The OApp's address.
    #[key]
    pub oapp: ContractAddress,
    /// The delegate's address.
    #[key]
    pub delegate: ContractAddress,
}
