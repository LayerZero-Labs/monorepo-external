//! Mock ULN config interface for testing

use layerzero::message_lib::uln_302::structs::uln_config::UlnConfig;

/// Mock interface to test UlnConfigStorageNode functionality
#[starknet::interface]
pub trait IMockUlnConfig<TContractState> {
    fn set_uln_config(ref self: TContractState, config: UlnConfig);
    fn _clear_dvns(ref self: TContractState);
    fn get_uln_config(self: @TContractState) -> UlnConfig;
    fn resolve(ref self: TContractState, default: UlnConfig, custom: UlnConfig) -> UlnConfig;
}
