//! ULN test utilities

use layerzero::message_lib::interface::{IMessageLibDispatcher, IMessageLibDispatcherTrait};
use layerzero::message_lib::structs::SetConfigParam;
use layerzero::message_lib::uln_302::structs::executor_config::ExecutorConfig;
use layerzero::message_lib::uln_302::structs::uln_config::UlnConfig;
use layerzero::message_lib::uln_302::ultra_light_node_302::UltraLightNode302::{
    CONFIG_TYPE_EXECUTOR, CONFIG_TYPE_ULN,
};
use starknet::ContractAddress;

// Helper functions for MessageLib interface
pub fn create_uln_send_config_param(eid: u32, config: UlnConfig) -> SetConfigParam {
    let mut serialized_config = array![];
    Serde::serialize(@config, ref serialized_config);
    SetConfigParam { eid, config_type: CONFIG_TYPE_ULN, config: serialized_config }
}

pub fn create_executor_send_config_param(eid: u32, config: ExecutorConfig) -> SetConfigParam {
    let mut serialized_config = array![];
    Serde::serialize(@config, ref serialized_config);
    SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: serialized_config }
}

pub fn create_uln_receive_config_param(eid: u32, config: UlnConfig) -> SetConfigParam {
    let mut serialized_config = array![];
    Serde::serialize(@config, ref serialized_config);
    SetConfigParam { eid, config_type: CONFIG_TYPE_ULN, config: serialized_config }
}

pub fn set_oapp_uln_send_config_via_message_lib(
    contract_address: ContractAddress, oapp: ContractAddress, eid: u32, config: UlnConfig,
) {
    let message_lib = IMessageLibDispatcher { contract_address };
    let param = create_uln_send_config_param(eid, config);
    message_lib.set_send_configs(oapp, array![param]);
}

pub fn set_oapp_executor_send_config_via_message_lib(
    contract_address: ContractAddress, oapp: ContractAddress, eid: u32, config: ExecutorConfig,
) {
    let message_lib = IMessageLibDispatcher { contract_address };
    let param = create_executor_send_config_param(eid, config);
    message_lib.set_send_configs(oapp, array![param]);
}

pub fn set_oapp_uln_receive_config_via_message_lib(
    contract_address: ContractAddress, oapp: ContractAddress, eid: u32, config: UlnConfig,
) {
    let message_lib = IMessageLibDispatcher { contract_address };
    let param = create_uln_receive_config_param(eid, config);
    message_lib.set_receive_configs(oapp, array![param]);
}
