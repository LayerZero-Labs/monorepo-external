//! Mock OAppCore interface for testing

/// Trait to expose internal functions
#[starknet::interface]
pub trait IMockOAppCore<TContractState> {
    // Internal functions from InternalTrait
    fn test_assert_only_endpoint(self: @TContractState);
    fn test_assert_only_owner(self: @TContractState);
    fn test_get_peer_or_revert(self: @TContractState, eid: u32) -> lz_utils::bytes::Bytes32;

    // Internal functions from OAppSender
    fn test_quote(
        self: @TContractState,
        dst_eid: u32,
        message: ByteArray,
        options: ByteArray,
        pay_in_lz_token: bool,
    ) -> layerzero::common::structs::messaging::MessagingFee;

    fn test_lz_send(
        ref self: TContractState,
        caller: starknet::ContractAddress,
        dst_eid: u32,
        message: ByteArray,
        options: ByteArray,
        fee: layerzero::common::structs::messaging::MessagingFee,
        refund_address: starknet::ContractAddress,
    ) -> layerzero::common::structs::messaging::MessageReceipt;

    fn test_pay_native(
        ref self: TContractState,
        caller: starknet::ContractAddress,
        endpoint: starknet::ContractAddress,
        contract_address: starknet::ContractAddress,
        fee: u256,
    );

    fn test_pay_lz_token(
        ref self: TContractState,
        caller: starknet::ContractAddress,
        endpoint: starknet::ContractAddress,
        contract_address: starknet::ContractAddress,
        fee: u256,
    );

    fn test_pay_in_token(
        ref self: TContractState,
        caller: starknet::ContractAddress,
        endpoint: starknet::ContractAddress,
        contract_address: starknet::ContractAddress,
        fee: u256,
        token_address: starknet::ContractAddress,
    );
}
