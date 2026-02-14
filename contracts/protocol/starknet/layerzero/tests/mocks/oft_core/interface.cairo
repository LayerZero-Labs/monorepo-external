//! Mock OFT Core interface for testing

use layerzero::oapps::oft::structs::{OFTDebit, OFTMsgAndOptions, SendParam};
use starknet::ContractAddress;

/// Trait to expose internal OFT Core functions for testing
#[starknet::interface]
pub trait IMockOFTCore<TContractState> {
    // Internal functions from OFTCore InternalTrait
    fn test_to_ld(self: @TContractState, amount_sd: u64) -> u256;
    fn test_to_sd(self: @TContractState, amount_ld: u256) -> u64;
    fn test_remove_dust(self: @TContractState, amount_ld: u256) -> u256;
    fn test_debit_view(
        self: @TContractState, amount_ld: u256, min_amount_ld: u256, dst_eid: u32,
    ) -> OFTDebit;
    fn test_build_msg_and_options(
        self: @TContractState, send_param: SendParam, amount_ld: u256,
    ) -> OFTMsgAndOptions;

    fn test_set_msg_inspector(ref self: TContractState, msg_inspector: ContractAddress);

    // Storage access functions
    fn test_shared_decimals(self: @TContractState) -> u8;
    fn test_decimal_conversion_rate(self: @TContractState) -> u256;

    // Initialize function for testing
    fn test_initializer(ref self: TContractState, local_decimals: u8);
}
