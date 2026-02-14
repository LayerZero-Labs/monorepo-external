//! Messaging channel events

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

/// Emitted when an inbound nonce is skipped.
#[derive(Drop, starknet::Event)]
pub struct InboundNonceSkipped {
    /// The receiver's address.
    #[key]
    pub receiver: ContractAddress,
    /// The source EID.
    #[key]
    pub src_eid: u32,
    /// The sender's address.
    #[key]
    pub sender: Bytes32,
    /// The skipped nonce.
    pub nonce: u64,
}

/// Emitted when a packet's payload hash is nilified (set to a placeholder value).
#[derive(Drop, starknet::Event)]
pub struct PacketNilified {
    /// The receiver's address.
    #[key]
    pub receiver: ContractAddress,
    /// The source EID.
    #[key]
    pub src_eid: u32,
    /// The sender's address.
    #[key]
    pub sender: Bytes32,
    /// The nonce of the packet.
    pub nonce: u64,
    /// The payload hash that was nilified.
    #[key]
    pub payload_hash: Bytes32,
}

/// Emitted when a packet's payload hash is burnt (cleared from storage).
#[derive(Drop, starknet::Event)]
pub struct PacketBurnt {
    /// The receiver's address.
    #[key]
    pub receiver: ContractAddress,
    /// The source EID.
    #[key]
    pub src_eid: u32,
    /// The sender's address.
    #[key]
    pub sender: Bytes32,
    /// The nonce of the packet.
    pub nonce: u64,
    /// The payload hash that was burnt.
    #[key]
    pub payload_hash: Bytes32,
}
