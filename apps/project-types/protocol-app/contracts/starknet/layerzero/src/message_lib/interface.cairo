//! Message library interface

use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::common::structs::messaging::{MessageLibSendResult, MessagingFee};
use crate::common::structs::packet::Packet;
use crate::message_lib::structs::{MessageLibType, MessageLibVersion, SetConfigParam};

#[derive(Drop, Serde, PartialEq, Debug)]
pub enum VerificationState {
    Verifying,
    Verifiable,
    Verified,
    NotInitializable,
}

/// Interface for message libraries
#[starknet::interface]
pub trait IMessageLib<TContractState> {
    fn send(
        ref self: TContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
    ) -> MessageLibSendResult;

    fn verify(
        ref self: TContractState,
        packet_header: ByteArray,
        payload_hash: Bytes32,
        confirmations: u64,
    );

    fn commit(ref self: TContractState, packet_header: ByteArray, payload_hash: Bytes32);

    fn quote(
        self: @TContractState, packet: Packet, options: ByteArray, pay_in_lz_token: bool,
    ) -> MessagingFee;

    fn version(self: @TContractState) -> MessageLibVersion;

    fn message_lib_type(self: @TContractState) -> MessageLibType;

    fn is_supported_send_eid(self: @TContractState, dst_eid: u32) -> bool;

    fn is_supported_receive_eid(self: @TContractState, src_eid: u32) -> bool;

    fn set_send_configs(
        ref self: TContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
    );

    fn set_receive_configs(
        ref self: TContractState, oapp: ContractAddress, params: Array<SetConfigParam>,
    );

    fn get_send_config(
        self: @TContractState, eid: u32, oapp: ContractAddress, config_type: u32,
    ) -> Array<felt252>;

    fn get_receive_config(
        self: @TContractState, eid: u32, oapp: ContractAddress, config_type: u32,
    ) -> Array<felt252>;

    fn verifiable(
        self: @TContractState, packet_header: ByteArray, payload_hash: Bytes32,
    ) -> VerificationState;
}
