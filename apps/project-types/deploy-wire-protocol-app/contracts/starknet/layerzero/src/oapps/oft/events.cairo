//! OFT events

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

#[derive(Drop, starknet::Event)]
pub struct OFTSent {
    #[key]
    pub guid: Bytes32,
    #[key]
    pub dst_eid: u32,
    #[key]
    pub from: ContractAddress,
    pub amount_sent_ld: u256,
    pub amount_received_ld: u256,
}

#[derive(Drop, starknet::Event)]
pub struct OFTReceived {
    #[key]
    pub guid: Bytes32,
    #[key]
    pub src_eid: u32,
    #[key]
    pub to: ContractAddress,
    pub amount_received_ld: u256,
}

#[derive(Drop, starknet::Event)]
pub struct MsgInspectorSet {
    #[key]
    pub msg_inspector: ContractAddress,
}
