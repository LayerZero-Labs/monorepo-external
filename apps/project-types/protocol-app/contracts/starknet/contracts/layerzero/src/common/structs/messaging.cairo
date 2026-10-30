//! Common messaging structs

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

/// Parameters required to send a message
#[derive(Drop, Serde, Clone, PartialEq, Debug, Default)]
pub struct MessagingParams {
    pub dst_eid: u32,
    pub receiver: Bytes32,
    pub message: ByteArray,
    pub options: ByteArray,
    pub pay_in_lz_token: bool,
}

#[derive(Drop, Serde, Default, PartialEq, Clone, Debug)]
pub struct MessagingFee {
    pub native_fee: u256,
    pub lz_token_fee: u256,
}

#[derive(Drop, Clone, Serde, PartialEq, Debug)]
pub struct Payee {
    pub receiver: ContractAddress,
    pub native_amount: u256,
    pub lz_token_amount: u256,
}

#[derive(Drop, Serde, Default, PartialEq, Clone, Debug)]
pub struct MessageReceipt {
    pub guid: Bytes32,
    pub nonce: u64,
    pub payees: Array<Payee>,
}

#[derive(Drop, Serde, PartialEq, Clone, Debug)]
pub struct MessageLibSendResult {
    pub message_receipt: MessageReceipt,
    pub encoded_packet: ByteArray,
}
