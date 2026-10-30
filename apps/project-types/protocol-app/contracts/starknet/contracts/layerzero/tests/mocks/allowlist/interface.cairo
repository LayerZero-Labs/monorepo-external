//! Mock allowlist interface for testing

use layerzero::oapps::common::allow_list::interface::AllowlistMode;
use starknet::ContractAddress;

#[starknet::interface]
pub trait IMockAllowlist<TContractState> {
    fn set_allowlist_mode(ref self: TContractState, mode: AllowlistMode);
    fn set_whitelisted(ref self: TContractState, users: Array<ContractAddress>, status: bool);
    fn set_blacklisted(ref self: TContractState, users: Array<ContractAddress>, status: bool);
    fn assert_allowlisted(self: @TContractState, user: ContractAddress);
}

