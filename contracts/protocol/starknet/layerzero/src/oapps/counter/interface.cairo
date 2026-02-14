use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;
use crate::common::structs::messaging::{MessageReceipt, MessagingFee};

#[starknet::interface]
pub trait IOmniCounter<TContractState> {
    // Get the counter value for a specific remote EID (to match existing tests)
    fn get_counter(self: @TContractState, remote_eid: u32) -> u256;

    // State getters
    fn get_count(self: @TContractState) -> u256;
    fn get_composed_count(self: @TContractState) -> u256;
    fn get_inbound_count(self: @TContractState, src_eid: u32) -> u256;
    fn get_outbound_count(self: @TContractState, dst_eid: u32) -> u256;
    fn get_admin(self: @TContractState) -> ContractAddress;
    fn get_eid(self: @TContractState) -> u32;
    fn get_ordered_nonce(self: @TContractState) -> bool;

    // Admin functions
    fn set_admin(ref self: TContractState, admin: ContractAddress);
    fn withdraw(ref self: TContractState, to: ContractAddress, amount: u256);

    // Nonce management
    fn set_ordered_nonce(ref self: TContractState, ordered_nonce: bool);
    fn skip_inbound_nonce(ref self: TContractState, src_eid: u32, sender: Bytes32, nonce: u64);

    // Peer management
    fn is_peer(self: @TContractState, eid: u32, peer: Bytes32) -> bool;

    // Messaging functions
    fn quote(
        self: @TContractState,
        dst_eid: u32,
        msg_type: u8,
        options: ByteArray,
        pay_in_lz_token: bool,
    ) -> MessagingFee;

    fn increment(
        ref self: TContractState,
        dst_eid: u32,
        msg_type: u8,
        options: ByteArray,
        fee: MessagingFee,
        refund_address: ContractAddress,
    ) -> MessageReceipt;
}
