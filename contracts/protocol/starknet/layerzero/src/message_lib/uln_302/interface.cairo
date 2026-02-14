//! Ultra light node admin interface

use layerzero::message_lib::uln_302::structs::executor_config::{
    ExecutorConfig, SetDefaultExecutorConfigParam,
};
use layerzero::message_lib::uln_302::structs::uln_config::{SetDefaultUlnConfigParam, UlnConfig};
use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

#[starknet::interface]
pub trait IUltraLightNode302Admin<TContractState> {
    // -- Setter functions for configuration
    /// Sets the default ULN send configuration for multiple destination endpoints
    fn set_default_uln_send_configs(
        ref self: TContractState, params: Array<SetDefaultUlnConfigParam>,
    );

    /// Sets the default ULN receive configuration for multiple destination endpoints
    fn set_default_uln_receive_configs(
        ref self: TContractState, params: Array<SetDefaultUlnConfigParam>,
    );

    /// Sets the default executor configurations for multiple destination endpoints
    fn set_default_executor_configs(
        ref self: TContractState, params: Array<SetDefaultExecutorConfigParam>,
    );

    // -- Getter functions for verification
    /// Gets the default ULN send configuration for a destination endpoint
    fn get_default_uln_send_config(self: @TContractState, dst_eid: u32) -> UlnConfig;

    /// Gets the default ULN receive configuration for a destination endpoint
    fn get_default_uln_receive_config(self: @TContractState, src_eid: u32) -> UlnConfig;

    /// Gets the raw (stored) ULN send configuration for a specific OApp
    fn get_raw_oapp_uln_send_config(
        self: @TContractState, oapp: ContractAddress, dst_eid: u32,
    ) -> UlnConfig;

    /// Gets the raw (stored) ULN receive configuration for a specific OApp
    fn get_raw_oapp_uln_receive_config(
        self: @TContractState, oapp: ContractAddress, src_eid: u32,
    ) -> UlnConfig;

    /// Gets the effective ULN send configuration for a specific OApp
    fn get_oapp_uln_send_config(
        self: @TContractState, oapp: ContractAddress, dst_eid: u32,
    ) -> UlnConfig;

    /// Gets the effective ULN receive configuration for a specific OApp
    fn get_oapp_uln_receive_config(
        self: @TContractState, oapp: ContractAddress, src_eid: u32,
    ) -> UlnConfig;

    /// Gets the default executor configuration for a destination endpoint
    fn get_default_executor_config(self: @TContractState, dst_eid: u32) -> ExecutorConfig;

    /// Gets the raw (stored) executor configuration for a specific OApp
    fn get_raw_oapp_executor_config(
        self: @TContractState, oapp: ContractAddress, dst_eid: u32,
    ) -> ExecutorConfig;

    /// Gets the effective executor configuration for a specific OApp
    fn get_oapp_executor_config(
        self: @TContractState, oapp: ContractAddress, dst_eid: u32,
    ) -> ExecutorConfig;

    /// Gets the current treasury contract address
    fn get_treasury(self: @TContractState) -> ContractAddress;

    /// Sets the treasury floor fee
    fn set_treasury_native_fee_cap(ref self: TContractState, native_fee_cap: u256);

    /// Gets the treasury native fee cap
    fn get_treasury_native_fee_cap(self: @TContractState) -> u256;

    /// Checks if the payload has been signed by a DVN
    ///
    /// # Arguments
    ///
    /// * `header_hash`: The header hash of the payload
    /// * `payload_hash`: The payload hash
    /// * `dvn`: The DVN contract address
    fn has_payload_signed(
        self: @TContractState, header_hash: Bytes32, payload_hash: Bytes32, dvn: ContractAddress,
    ) -> bool;
}
