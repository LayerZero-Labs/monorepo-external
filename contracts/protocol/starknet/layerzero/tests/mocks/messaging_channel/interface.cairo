use layerzero::Origin;
use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockMessagingChannel<TContractState> {
    fn fake_commit(
        ref self: TContractState, receiver: ContractAddress, origin: Origin, payload_hash: Bytes32,
    );
    fn fake_send(
        ref self: TContractState, sender: ContractAddress, dst_eid: u32, receiver: Bytes32,
    );
    fn test_clear_payload(
        ref self: TContractState, receiver: ContractAddress, origin: Origin, payload: ByteArray,
    );
    fn test_skip(ref self: TContractState, receiver: ContractAddress, origin: Origin);
    fn test_nilify(
        ref self: TContractState, receiver: ContractAddress, origin: Origin, payload_hash: Bytes32,
    );
    fn test_burn(
        ref self: TContractState, receiver: ContractAddress, origin: Origin, payload_hash: Bytes32,
    );
}
