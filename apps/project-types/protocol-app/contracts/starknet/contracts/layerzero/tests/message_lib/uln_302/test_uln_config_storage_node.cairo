//! ULN config storage node tests

use core::traits::TryInto;
use layerzero::message_lib::uln_302::structs::uln_config::UlnConfig;
use snforge_std::{ContractClassTrait, DeclareResultTrait, declare};
use starknet::{ContractAddress, SyscallResultTrait};
use crate::mocks::uln_config::interface::{IMockUlnConfigDispatcher, IMockUlnConfigDispatcherTrait};

// Test constants
const DVN_1: ContractAddress = 1.try_into().unwrap();
const DVN_2: ContractAddress = 2.try_into().unwrap();
const DVN_3: ContractAddress = 3.try_into().unwrap();
const DVN_4: ContractAddress = 4.try_into().unwrap();

fn deploy_mock_uln_config_node() -> IMockUlnConfigDispatcher {
    let contract = declare("MockUlnConfig").unwrap_syscall().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap_syscall();
    IMockUlnConfigDispatcher { contract_address }
}

#[test]
fn test_set_and_get_uln_config() {
    let dispatcher = deploy_mock_uln_config_node();

    let config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        optional_dvn_threshold: 2,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: false,
        optional_dvns: array![DVN_3, DVN_4],
        has_optional_dvns: false,
    };

    dispatcher.set_uln_config(config.clone());
    let retrieved_config = dispatcher.get_uln_config();

    assert(retrieved_config == config, 'config mismatch');
}

#[test]
fn test__clear_dvns() {
    let dispatcher = deploy_mock_uln_config_node();

    let config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        optional_dvn_threshold: 1,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: false,
        optional_dvns: array![DVN_3, DVN_4],
        has_optional_dvns: false,
    };

    dispatcher.set_uln_config(config);
    dispatcher._clear_dvns();

    let retrieved_config = dispatcher.get_uln_config();
    let expected_config = UlnConfig {
        confirmations: 10,
        has_confirmations: false,
        optional_dvn_threshold: 1,
        required_dvns: array![],
        has_required_dvns: false,
        optional_dvns: array![],
        has_optional_dvns: false,
    };
    assert(retrieved_config == expected_config, 'config mismatch');
}
