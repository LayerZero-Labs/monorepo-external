//! DVN events

use lz_utils::bytes::Bytes32;
use crate::workers::dvn::structs::{ExecuteParam, SetDstConfigParams};

/// Event emitted when the destination config is set
#[derive(Drop, starknet::Event)]
pub struct DstConfigSet {
    pub dst_config_set: Span<SetDstConfigParams>,
}

/// Event emitted when the signatures are not valid
#[derive(Drop, starknet::Event)]
pub struct VerifySignaturesFailed {
    pub error: ByteArray,
}

/// Event emitted when the hash is already used
#[derive(Drop, starknet::Event)]
pub struct HashAlreadyUsed {
    pub execute_param: ExecuteParam,
    pub hash: Bytes32,
}

/// Event emitted when the execute call fails
#[derive(Drop, starknet::Event)]
pub struct ExecuteFailed {
    pub index: u32,
    pub data: Array<felt252>,
}
