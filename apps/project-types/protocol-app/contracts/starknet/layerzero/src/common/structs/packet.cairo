//! Common structs - `Packet` and `Origin`

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

#[derive(Clone, Drop, Serde)]
pub struct PacketHeader {
    pub nonce: u64,
    pub src_eid: u32,
    pub sender: ContractAddress,
    pub dst_eid: u32,
    pub receiver: Bytes32,
}

#[derive(Clone, Drop, Serde)]
pub struct Packet {
    pub nonce: u64,
    pub src_eid: u32,
    pub sender: ContractAddress,
    pub dst_eid: u32,
    pub receiver: Bytes32,
    pub guid: Bytes32,
    pub message: ByteArray,
}

#[derive(Clone, Drop, Serde, Debug, PartialEq, Default)]
pub struct Origin {
    pub src_eid: u32,
    pub sender: Bytes32,
    pub nonce: u64,
}
