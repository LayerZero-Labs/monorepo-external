//! Simple message library events

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

#[derive(Drop, PartialEq, starknet::Event)]
pub struct PacketSent {
    pub nonce: u64,
    #[key]
    pub src_eid: u32,
    #[key]
    pub sender: ContractAddress,
    #[key]
    pub dst_eid: u32,
    #[key]
    pub receiver: Bytes32,
    #[key]
    pub guid: Bytes32,
}

#[derive(Drop, PartialEq, starknet::Event, Serde)]
pub struct PacketVerified {
    pub nonce: u64,
    #[key]
    pub src_eid: u32,
    #[key]
    pub sender: Bytes32,
    #[key]
    pub dst_eid: u32,
    #[key]
    pub receiver: ContractAddress,
}
