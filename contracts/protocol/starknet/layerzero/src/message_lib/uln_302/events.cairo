//! Ultra light node events

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::common::structs::messaging::Payee;
use crate::common::structs::packet::PacketHeader;
use crate::message_lib::uln_302::structs::executor_config::{
    ExecutorConfig, SetDefaultExecutorConfigParam,
};
use crate::message_lib::uln_302::structs::uln_config::{SetDefaultUlnConfigParam, UlnConfig};

#[derive(Drop, PartialEq, starknet::Event)]
pub struct DefaultUlnSendConfigsSet {
    pub params: Array<SetDefaultUlnConfigParam>,
}

#[derive(Drop, PartialEq, starknet::Event)]
pub struct DefaultUlnReceiveConfigsSet {
    pub params: Array<SetDefaultUlnConfigParam>,
}


#[derive(Drop, PartialEq, starknet::Event)]
pub struct OAppUlnSendConfigSet {
    #[key]
    pub oapp: ContractAddress,
    pub dst_eid: u32,
    pub config: UlnConfig,
}

#[derive(Drop, PartialEq, starknet::Event)]
pub struct OAppUlnReceiveConfigSet {
    #[key]
    pub oapp: ContractAddress,
    pub src_eid: u32,
    pub config: UlnConfig,
}

#[derive(Drop, PartialEq, starknet::Event)]
pub struct DefaultExecutorConfigsSet {
    pub params: Array<SetDefaultExecutorConfigParam>,
}

#[derive(Drop, PartialEq, starknet::Event)]
pub struct OAppExecutorConfigSet {
    #[key]
    pub oapp: ContractAddress,
    pub dst_eid: u32,
    pub config: ExecutorConfig,
}

#[derive(Drop, starknet::Event)]
pub struct DvnFeesPaid {
    #[key]
    pub oapp: ContractAddress,
    pub payees: Array<Payee>,
    #[key]
    pub packet_header: PacketHeader,
}

#[derive(Drop, starknet::Event)]
pub struct ExecutorFeePaid {
    #[key]
    pub oapp: ContractAddress,
    #[key]
    pub payee: Payee,
    #[key]
    pub packet_header: PacketHeader,
}

#[derive(Drop, starknet::Event)]
pub struct TreasuryFeePaid {
    #[key]
    pub oapp: ContractAddress,
    #[key]
    pub payee: Payee,
    #[key]
    pub packet_header: PacketHeader,
}

#[derive(Drop, starknet::Event)]
pub struct TreasuryNativeFeeCapSet {
    pub native_fee_cap: u256,
}

/// This is emitted when a Payload Hash is verified by a single DVN
#[derive(Drop, Debug, PartialEq, starknet::Event)]
pub struct PayloadVerified {
    #[key]
    pub dvn: ContractAddress,
    pub header: ByteArray,
    pub confirmations: u256,
    pub proof_hash: Bytes32,
}
