//! Message lib manager tests

use MockMessageLibManager::{IMockManagerHelpersDispatcher, IMockManagerHelpersDispatcherTrait};
use layerzero::endpoint::message_lib_manager::errors::{
    err_already_registered, err_default_receive_lib_unavailable, err_default_send_lib_unavailable,
    err_invalid_expiry, err_only_non_default_lib, err_only_receive_lib, err_only_registered_lib,
    err_only_registered_or_default_lib, err_only_send_lib, err_same_value, err_unsupported_eid,
};
use layerzero::endpoint::message_lib_manager::events::{
    DefaultReceiveLibrarySet, DefaultReceiveLibraryTimeoutSet, DefaultSendLibrarySet,
    LibraryRegistered, ReceiveLibrarySet, ReceiveLibraryTimeoutSet, SendLibrarySet,
};
use layerzero::endpoint::message_lib_manager::interface::{
    IMessageLibManagerDispatcherTrait, IMessageLibManagerSafeDispatcherTrait,
};
use layerzero::endpoint::message_lib_manager::message_lib_manager::MessageLibManagerComponent;
use layerzero::endpoint::message_lib_manager::structs::Timeout;
use layerzero::message_lib::structs::{MessageLibType, SetConfigParam};
use layerzero::message_lib::uln_302::structs::executor_config::ExecutorConfig;
use layerzero::message_lib::uln_302::structs::uln_config::UlnConfig;
use layerzero::message_lib::uln_302::ultra_light_node_302::UltraLightNode302::{
    CONFIG_TYPE_EXECUTOR, CONFIG_TYPE_ULN,
};
use openzeppelin::access::ownable::OwnableComponent::Errors::NOT_OWNER as OZ_NOT_OWNER;
// import fuzzable types
use snforge_std::fuzzable::{FuzzableU32, FuzzableU64};
use snforge_std::{
    EventSpyAssertionsTrait, spy_events, start_cheat_block_number, start_cheat_caller_address,
    start_mock_call, stop_cheat_block_number, stop_cheat_caller_address,
};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::{assert_panic_with_error, assert_panic_with_felt_error};
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::mocks::message_lib_manager::MockMessageLibManager;
use crate::mocks::message_lib_manager::MockMessageLibManager::err_not_authorized;
use super::utils::{MessageLibManagerMock, deploy_erc20_mock, deploy_message_lib_manager};

// =============================== Helper Functions =================================

/// Helper function to create a ULN config parameter
fn create_uln_config_param(eid: u32, config: UlnConfig) -> SetConfigParam {
    let mut serialized_config = array![];
    Serde::serialize(@config, ref serialized_config);
    SetConfigParam { eid, config_type: CONFIG_TYPE_ULN, config: serialized_config }
}

/// Helper function to create an executor config parameter
fn create_executor_config_param(eid: u32, config: ExecutorConfig) -> SetConfigParam {
    let mut serialized_config = array![];
    Serde::serialize(@config, ref serialized_config);
    SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: serialized_config }
}

/// Helper function to create a simple ULN config for testing
fn create_test_uln_config() -> UlnConfig {
    UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    }
}

/// Helper function to create a simple executor config for testing
fn create_test_executor_config(executor: ContractAddress) -> ExecutorConfig {
    ExecutorConfig { max_message_size: 1000, executor }
}

// =============================== Test Register Library =================================

#[test]
#[fuzzer(runs: 1)]
fn should_register_library(owner: ContractAddress, new_library: ContractAddress) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Check that the library is not registered
    assert(!dispatcher.is_registered_library(new_library), 'should not be registered');

    let mut spy = spy_events();
    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, owner);
    // Mock message_lib_type to satisfy registration-time type check
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::SendAndReceive);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is registered
    assert(dispatcher.is_registered_library(new_library), 'should be registered');

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::LibraryRegistered(
            LibraryRegistered { library: new_library },
        ),
    );

    // Check that the event is emitted
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_register_library_when_not_owner(
    owner: ContractAddress, not_owner: ContractAddress, new_library: ContractAddress,
) {
    if not_owner == owner {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Check that the library is not registered
    assert(
        !safe_dispatcher.is_registered_library(new_library).unwrap(), 'should not be registered',
    );

    // Caller is not the owner
    start_cheat_caller_address(message_lib_manager, not_owner);
    let res = safe_dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is not registered
    assert_panic_with_felt_error(res, OZ_NOT_OWNER);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_register_library_when_already_registered(
    owner: ContractAddress, new_library: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::SendAndReceive);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is registered
    assert(safe_dispatcher.is_registered_library(new_library).unwrap(), 'should be registered');

    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);
    assert_panic_with_error(res, err_already_registered());
}

#[test]
#[should_panic]
#[fuzzer(runs: 1)]
fn should_fail_to_register_library_when_not_message_lib(owner: ContractAddress) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Using erc20 mock because we have to use a deployed contract
    let erc20_mock = deploy_erc20_mock();

    // Owner attempts to register, but target does not implement IMessageLib
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(erc20_mock);
    stop_cheat_caller_address(message_lib_manager);
}

// =============================== Test Set Send Library =================================

#[test]
#[fuzzer(runs: 1)]
fn should_set_send_library(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), true);

    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    let mut spy = spy_events();
    // Set the send library
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_send_library(oapp, eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is set
    let res = dispatcher.get_send_library(oapp, eid);
    assert(res.lib == new_library, 'should be set');
    assert(!res.is_default, 'should not be default');
    // Check raw send library is there
    let res = dispatcher.get_raw_send_library(oapp, eid);
    assert(res == new_library, 'should be set');

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::SendLibrarySet(
            SendLibrarySet { sender: oapp, dst_eid: eid, library: new_library },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
fn should_set_send_library_when_already_set(
    owner: ContractAddress,
    new_library: ContractAddress,
    second_new_library: ContractAddress,
    eid: u32,
    oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Set the initial send library
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_send_library(oapp, eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Mock call to supported eid
    start_mock_call(second_new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::SendAndReceive;
    start_mock_call(second_new_library, selector!("message_lib_type"), message_lib_type);

    // Register the second library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(second_new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Set the second send library
    let mut spy = spy_events();
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_send_library(oapp, eid, second_new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is set
    assert(dispatcher.get_send_library(oapp, eid).lib == second_new_library, 'should be set');
    // Check raw send library is there
    assert(dispatcher.get_raw_send_library(oapp, eid) == second_new_library, 'should be set');

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::SendLibrarySet(
            SendLibrarySet { sender: oapp, dst_eid: eid, library: second_new_library },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_library_when_not_registered(
    owner: ContractAddress, unregistered_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_library(oapp, eid, unregistered_library);
    stop_cheat_caller_address(message_lib_manager);
    assert_panic_with_error(res, err_only_registered_or_default_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_library_when_not_send(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_library(oapp, eid, new_library);
    stop_cheat_caller_address(message_lib_manager);
    assert_panic_with_error(res, err_only_send_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_library_when_not_supported_eid(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), false);

    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_library(oapp, eid, new_library);
    stop_cheat_caller_address(message_lib_manager);
    assert_panic_with_error(res, err_unsupported_eid(eid));
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_library_when_same_value(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, oapp);
    safe_dispatcher.set_send_library(oapp, eid, new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Set the same library again
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_library(oapp, eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_same_value());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_get_send_library_when_not_set_and_not_default(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock { safe_dispatcher, .. } = deploy_message_lib_manager(owner);

    let res = safe_dispatcher.get_send_library(oapp, eid);

    assert_panic_with_error(res, err_default_send_lib_unavailable());
}

// =============================== Test Set Default Send Library =================================

#[test]
#[fuzzer(runs: 1)]
fn test_set_default_send_library(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    let mut spy = spy_events();

    // Set the default send library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_send_library(eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is set
    assert(dispatcher.get_default_send_library(eid) == new_library, 'should be set');
    // Check if is default send library
    assert(dispatcher.is_default_send_library(oapp, eid), 'should be default send library');
    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::DefaultSendLibrarySet(
            DefaultSendLibrarySet { eid, library: new_library },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
fn should_set_default_send_library_when_already_set(
    owner: ContractAddress,
    new_library: ContractAddress,
    second_new_library: ContractAddress,
    eid: u32,
    oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Set the default send library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_send_library(eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Mock call to supported eid
    start_mock_call(second_new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::SendAndReceive;
    start_mock_call(second_new_library, selector!("message_lib_type"), message_lib_type);

    // Register the second library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(second_new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Set the second default send library
    let mut spy = spy_events();
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_send_library(eid, second_new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is set
    assert(dispatcher.get_default_send_library(eid) == second_new_library, 'should be set');
    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::DefaultSendLibrarySet(
            DefaultSendLibrarySet { eid, library: second_new_library },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_send_library_when_not_owner(
    owner: ContractAddress, not_owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    if not_owner == owner {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::SendAndReceive);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is not the owner
    start_cheat_caller_address(message_lib_manager, not_owner);
    let res = safe_dispatcher.set_default_send_library(eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_felt_error(res, OZ_NOT_OWNER);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_send_library_when_not_registered(
    owner: ContractAddress, unregistered_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Caller is the owner but library is not registered
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_send_library(eid, unregistered_library);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_registered_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_send_library_when_not_send(
    owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type (not a send library)
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_send_library(eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_send_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_send_library_when_not_supported_eid(
    owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid (not supported)
    start_mock_call(new_library, selector!("is_supported_send_eid"), false);

    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_send_library(eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_unsupported_eid(eid));
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_send_library_when_same_value(
    owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Set the default send library first
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.set_default_send_library(eid, new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Try to set the same library again
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_send_library(eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_same_value());
}

// =============================== Test Set Receive Library =================================

#[test]
#[fuzzer(runs: 1)]
fn should_set_receive_library(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);

    // Mock call to message lib type
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    let mut spy = spy_events();
    // Set the receive library
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is set
    let res = dispatcher.get_receive_library(oapp, eid);
    assert(res.lib == new_library, 'should be set');
    assert(!res.is_default, 'should not be default');
    // Check raw receive library is there
    let res = dispatcher.get_raw_receive_library(oapp, eid);
    assert(res == new_library, 'should be set');

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::ReceiveLibrarySet(
            ReceiveLibrarySet { receiver: oapp, src_eid: eid, library: new_library },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_library_when_not_registered(
    owner: ContractAddress, unregistered_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Caller is oapp
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_library(oapp, eid, unregistered_library, 0);
    stop_cheat_caller_address(message_lib_manager);
    assert_panic_with_error(res, err_only_registered_or_default_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_library_when_not_receive_lib(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is oapp
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_library(oapp, eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);
    assert_panic_with_error(res, err_only_receive_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_get_receive_library_when_not_set_and_not_default(
    owner: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Caller is oapp
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.get_receive_library(oapp, eid);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_default_receive_lib_unavailable());
}

// =============================== Test Set Default Receive Library
// =================================

#[test]
#[fuzzer(runs: 1)]
fn should_set_default_receive_library(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    let mut spy = spy_events();

    // Set the default receive library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_receive_library(eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    // Check that the library is set
    let lib = dispatcher.get_default_receive_library(eid);
    assert(lib == new_library, 'should be set');

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::DefaultReceiveLibrarySet(
            DefaultReceiveLibrarySet { eid, library: new_library },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_receive_library_when_not_owner(
    owner: ContractAddress, not_owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    if not_owner == owner {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, not_owner);
    let res = safe_dispatcher.set_default_receive_library(eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_felt_error(res, OZ_NOT_OWNER);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_receive_library_when_not_registered(
    owner: ContractAddress, unregistered_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Caller is the owner but library is not registered
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_receive_library(eid, unregistered_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_registered_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_receive_library_when_not_receive(
    owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);

    // Mock call to message lib type (not a receive library)
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_receive_library(eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_receive_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_receive_library_when_not_supported_eid(
    owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid (not supported)
    start_mock_call(new_library, selector!("is_supported_receive_eid"), false);

    // Mock call to message lib type
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Caller is the owner
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_receive_library(eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_unsupported_eid(eid));
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_receive_library_when_same_value(
    owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Set the default receive library first
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.set_default_receive_library(eid, new_library, 0).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Try to set the same library again
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher.set_default_receive_library(eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_same_value());
}

// ========================= Test Set Receive Library Timeout ==============================

#[test]
#[fuzzer(runs: 1)]
fn should_set_receive_library_timeout(
    owner: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    oapp: ContractAddress,
    expiry: u64,
) {
    // Skip expiry == 0, its special case and is tested under
    if expiry == 0 {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock calls
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Set the receive library for the oapp
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_block_number(message_lib_manager, 1);

    let mut spy = spy_events();
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library_timeout(oapp, eid, new_library, expiry);
    stop_cheat_caller_address(message_lib_manager);

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::ReceiveLibraryTimeoutSet(
            ReceiveLibraryTimeoutSet { receiver: oapp, eid, library: new_library, expiry },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
    stop_cheat_block_number(message_lib_manager);

    let timeout = dispatcher.get_receive_library_timeout(oapp, eid);
    let expected_timeout = Timeout { lib: new_library, expiry };
    assert(timeout == expected_timeout, 'should be set');
}

#[test]
#[fuzzer(runs: 1)]
fn should_set_receive_library_timeout_to_0(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock calls
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // Set the receive library for the oapp
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    let mut spy = spy_events();
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library_timeout(oapp, eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    let timeout = dispatcher.get_receive_library_timeout(oapp, eid);
    let expected_timeout = Default::default();
    assert(timeout == expected_timeout, 'should be set');

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::ReceiveLibraryTimeoutSet(
            ReceiveLibraryTimeoutSet { receiver: oapp, eid, library: new_library, expiry: 0 },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_library_timeout_for_default_lib(
    owner: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    oapp: ContractAddress,
    expiry: u64,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register and set as default
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.set_default_receive_library(eid, new_library, 0).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Try to set timeout as oapp (using default)
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_library_timeout(oapp, eid, new_library, expiry);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_non_default_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_library_timeout_with_invalid_expiry(
    owner: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    oapp: ContractAddress,
    block_timestamp: u64,
    timestamp_delta: u64,
) {
    // Skip if block_timestamp is 0 to prevent division by 0
    if block_timestamp == 0 {
        return;
    }
    let timestamp_delta =
        timestamp_delta % block_timestamp; // Ensure timestamp_delta is less than block_timestamp
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, oapp);
    safe_dispatcher.set_receive_library(oapp, eid, new_library, 0).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_block_number(message_lib_manager, block_timestamp);
    start_cheat_caller_address(message_lib_manager, oapp);
    // Expired timestamp
    let res = safe_dispatcher
        .set_receive_library_timeout(oapp, eid, new_library, block_timestamp - timestamp_delta);
    stop_cheat_caller_address(message_lib_manager);
    stop_cheat_block_number(message_lib_manager);

    assert_panic_with_error(res, err_invalid_expiry());
}

// ====================== Test Set Default Receive Library Timeout ======================

#[test]
#[fuzzer(runs: 1)]
fn should_set_default_receive_library_timeout(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, expiry: u64,
) {
    // Skip expiry == 0, its special case and is tested elsewhere
    if expiry == 0 {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_block_number(message_lib_manager, 1);

    let mut spy = spy_events();
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_receive_library_timeout(eid, new_library, expiry);
    stop_cheat_caller_address(message_lib_manager);

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::DefaultReceiveLibraryTimeoutSet(
            DefaultReceiveLibraryTimeoutSet { eid, library: new_library, expiry },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
    stop_cheat_block_number(message_lib_manager);

    let timeout = dispatcher.get_default_receive_library_timeout(eid);
    let expected_timeout = Timeout { lib: new_library, expiry };
    assert(timeout == expected_timeout, 'should be set');
}

#[test]
#[fuzzer(runs: 1)]
fn should_set_default_receive_library_timeout_to_0(
    owner: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    let mut spy = spy_events();
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_receive_library_timeout(eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    let timeout = dispatcher.get_default_receive_library_timeout(eid);
    let expected_timeout = Default::default();
    assert(timeout == expected_timeout, 'should be set');

    let expected_event = MockMessageLibManager::Event::MessageLibManagerEvent(
        MessageLibManagerComponent::Event::DefaultReceiveLibraryTimeoutSet(
            DefaultReceiveLibraryTimeoutSet { eid, library: new_library, expiry: 0 },
        ),
    );
    spy.assert_emitted(@array![(message_lib_manager, expected_event)]);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_receive_library_timeout_when_not_owner(
    owner: ContractAddress,
    not_owner: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    expiry: u64,
) {
    if not_owner == owner {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, not_owner);
    let res = safe_dispatcher.set_default_receive_library_timeout(eid, new_library, expiry);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_felt_error(res, OZ_NOT_OWNER);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_default_receive_library_timeout_with_invalid_expiry(
    owner: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    block_timestamp: u64,
    timestamp_delta: u64,
) {
    // Skip if block_timestamp is 0 to prevent division by 0
    if block_timestamp == 0 {
        return;
    }
    let timestamp_delta =
        timestamp_delta % block_timestamp; // Ensure timestamp_delta is less than block_timestamp
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_block_number(message_lib_manager, block_timestamp);
    start_cheat_caller_address(message_lib_manager, owner);
    let res = safe_dispatcher
        .set_default_receive_library_timeout(eid, new_library, block_timestamp - timestamp_delta);
    stop_cheat_caller_address(message_lib_manager);
    stop_cheat_block_number(message_lib_manager);

    assert_panic_with_error(res, err_invalid_expiry());
}

// =============================== Test Is Valid Receive Library =================================

#[test]
#[fuzzer(runs: 1)]
fn should_return_true_for_current_library(
    owner: ContractAddress, oapp: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, new_library);
    assert(is_valid, 'should be valid');
}

#[test]
#[fuzzer(runs: 1)]
fn should_return_true_for_current_default_library(
    owner: ContractAddress, oapp: ContractAddress, new_library: ContractAddress, eid: u32,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // mock calls to supported eid
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    // mock call to message lib type
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(new_library);
    dispatcher.set_default_receive_library(eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, new_library);
    assert(is_valid, 'should be valid');
}

#[test]
#[fuzzer(runs: 1)]
fn should_return_false_for_wrong_library(
    owner: ContractAddress,
    oapp: ContractAddress,
    supported_library: ContractAddress,
    unsupported_library: ContractAddress,
    eid: u32,
) {
    if supported_library == unsupported_library {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(supported_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(supported_library, selector!("message_lib_type"), MessageLibType::Receive);
    start_mock_call(
        unsupported_library, selector!("message_lib_type"), MessageLibType::SendAndReceive,
    );

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(supported_library);
    dispatcher.register_library(unsupported_library);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, supported_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, unsupported_library);
    assert(!is_valid, 'should not be valid');
}

#[test]
#[fuzzer(runs: 1)]
fn should_return_true_for_old_library_in_grace_period(
    owner: ContractAddress,
    oapp: ContractAddress,
    old_library: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    grace_period: u64,
) {
    // 0 grace period is a case where there won't be a timeout set, so can't be true
    if grace_period == 0 {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(old_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(old_library, selector!("message_lib_type"), MessageLibType::Receive);
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(old_library);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, old_library, 0);
    dispatcher.set_receive_library(oapp, eid, new_library, grace_period);
    stop_cheat_caller_address(message_lib_manager);

    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, old_library);
    assert(is_valid, 'should be valid in grace period');
}


#[test]
#[fuzzer(runs: 1)]
fn should_return_false_for_old_library_after_grace_period(
    owner: ContractAddress,
    oapp: ContractAddress,
    old_library: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    grace_period: u64,
) {
    // grace period == 0 is a special case and will become have a different timeout outcome
    if grace_period == 0 {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(old_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(old_library, selector!("message_lib_type"), MessageLibType::Receive);
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(old_library);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // set block number to 0 so that grace period will be 0 + grace_period
    start_cheat_block_number(message_lib_manager, 0);
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, old_library, 0);
    dispatcher.set_receive_library(oapp, eid, new_library, grace_period);
    stop_cheat_caller_address(message_lib_manager);
    stop_cheat_block_number(message_lib_manager);

    start_cheat_block_number(message_lib_manager, grace_period + 1);
    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, old_library);
    assert(!is_valid, 'should be invalid after grace');
    stop_cheat_block_number(message_lib_manager);

    let timeout = dispatcher.get_receive_library_timeout(oapp, eid);
    let expected_timeout = Timeout { lib: old_library, expiry: grace_period };
    assert(timeout == expected_timeout, 'should be set');
}

#[test]
#[fuzzer(runs: 1)]
fn should_return_false_for_old_library_after_grace_period_with_0_grace_period(
    owner: ContractAddress,
    oapp: ContractAddress,
    old_library: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
) {
    let grace_period = 0;

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(old_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(old_library, selector!("message_lib_type"), MessageLibType::Receive);
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(old_library);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // set block number to 0 so that grace period will be 0 + grace_period
    start_cheat_block_number(message_lib_manager, 0);
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_library(oapp, eid, old_library, 0);
    dispatcher.set_receive_library(oapp, eid, new_library, grace_period);
    stop_cheat_caller_address(message_lib_manager);
    stop_cheat_block_number(message_lib_manager);

    start_cheat_block_number(message_lib_manager, grace_period + 1);
    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, old_library);
    assert(!is_valid, 'should be invalid after grace');
    stop_cheat_block_number(message_lib_manager);

    let timeout = dispatcher.get_receive_library_timeout(oapp, eid);
    let expected_timeout = Default::default();
    assert(timeout == expected_timeout, 'should be set');
}

#[test]
#[fuzzer(runs: 1)]
fn should_return_true_for_old_default_library_in_grace_period(
    owner: ContractAddress,
    oapp: ContractAddress,
    old_library: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    grace_period: u64,
) {
    // 0 grace period is a special case and won't return true
    if grace_period == 0 {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(old_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(old_library, selector!("message_lib_type"), MessageLibType::Receive);
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(old_library);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_receive_library(eid, old_library, 0);
    dispatcher.set_default_receive_library(eid, new_library, grace_period);
    stop_cheat_caller_address(message_lib_manager);

    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, old_library);
    assert(is_valid, 'should be valid in grace period');
}

#[test]
#[fuzzer(runs: 1)]
fn should_return_false_for_old_default_library_after_grace_period(
    owner: ContractAddress,
    oapp: ContractAddress,
    old_library: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    grace_period: u64,
) {
    // 0 grace period is a special case and will have a different timeout outcome
    if grace_period == 0 {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(old_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(old_library, selector!("message_lib_type"), MessageLibType::Receive);
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(old_library);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // set block number to 0 so that grace period will be 0 + grace_period
    start_cheat_block_number(message_lib_manager, 0);
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_receive_library(eid, old_library, 0);
    dispatcher.set_default_receive_library(eid, new_library, grace_period);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_block_number(message_lib_manager, grace_period + 1);
    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, old_library);
    assert(!is_valid, 'should be invalid after grace');
    stop_cheat_block_number(message_lib_manager);

    let timeout = dispatcher.get_default_receive_library_timeout(eid);
    let expected_timeout = Timeout { lib: old_library, expiry: grace_period };
    assert(timeout == expected_timeout, 'should be set');
}

#[test]
#[fuzzer(runs: 1)]
fn should_return_false_for_old_default_library_after_grace_period_with_0_grace_period(
    owner: ContractAddress,
    oapp: ContractAddress,
    old_library: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
) {
    let grace_period = 0;

    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    start_mock_call(old_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(old_library, selector!("message_lib_type"), MessageLibType::Receive);
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(old_library);
    dispatcher.register_library(new_library);
    stop_cheat_caller_address(message_lib_manager);

    // set block number to 0 so that grace period will be 0 + grace_period
    start_cheat_block_number(message_lib_manager, 0);
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.set_default_receive_library(eid, old_library, 0);
    dispatcher.set_default_receive_library(eid, new_library, grace_period);
    stop_cheat_caller_address(message_lib_manager);

    start_cheat_block_number(message_lib_manager, grace_period + 1);
    let is_valid = dispatcher.is_valid_receive_library(oapp, eid, old_library);
    assert(!is_valid, 'should be invalid after grace');
    stop_cheat_block_number(message_lib_manager);

    let timeout = dispatcher.get_default_receive_library_timeout(eid);
    let expected_timeout = Default::default();
    assert(timeout == expected_timeout, 'should be set');
}

// =============================== Test Authorization Failures =================================

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_library_when_not_authorized(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_send_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Send;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Enable authorization throwing
    let mock_helpers = IMockManagerHelpersDispatcher { contract_address: message_lib_manager };
    mock_helpers.set_throw_on_authorize(true);

    // Try to set the send library - should fail due to authorization
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_library(oapp, eid, new_library);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_not_authorized());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_library_when_not_authorized(
    owner: ContractAddress, new_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to supported eid
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    // Mock call to message lib type
    let message_lib_type = MessageLibType::Receive;
    start_mock_call(new_library, selector!("message_lib_type"), message_lib_type);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Enable authorization throwing
    let mock_helpers = IMockManagerHelpersDispatcher { contract_address: message_lib_manager };
    mock_helpers.set_throw_on_authorize(true);

    // Try to set the receive library - should fail due to authorization
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_library(oapp, eid, new_library, 0);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_not_authorized());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_library_timeout_when_not_authorized(
    owner: ContractAddress,
    new_library: ContractAddress,
    eid: u32,
    oapp: ContractAddress,
    expiry: u64,
) {
    // Skip expiry == 0, its special case and is tested elsewhere
    if expiry == 0 {
        return;
    }

    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock calls
    start_mock_call(new_library, selector!("is_supported_receive_eid"), true);
    start_mock_call(new_library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(new_library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Set the receive library for the oapp first (without authorization throwing)
    start_cheat_caller_address(message_lib_manager, oapp);
    safe_dispatcher.set_receive_library(oapp, eid, new_library, 0).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Enable authorization throwing
    let mock_helpers = IMockManagerHelpersDispatcher { contract_address: message_lib_manager };
    mock_helpers.set_throw_on_authorize(true);

    start_cheat_block_number(message_lib_manager, 1);

    // Try to set the receive library timeout - should fail due to authorization
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_library_timeout(oapp, eid, new_library, expiry);
    stop_cheat_caller_address(message_lib_manager);

    stop_cheat_block_number(message_lib_manager);

    assert_panic_with_error(res, err_not_authorized());
}

// =============================== Test Set Send Config =================================

#[test]
#[fuzzer(runs: 1)]
fn should_set_send_config_with_uln_config(
    owner: ContractAddress, library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Send);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(library);
    stop_cheat_caller_address(message_lib_manager);

    // Create ULN config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Mock the set_send_config call on the library
    start_mock_call(library, selector!("set_send_configs"), ());

    // Set the send config
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_send_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);
}

#[test]
#[fuzzer(runs: 1)]
fn should_set_send_config_with_executor_config(
    owner: ContractAddress,
    library: ContractAddress,
    eid: u32,
    oapp: ContractAddress,
    executor: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Send);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(library);
    stop_cheat_caller_address(message_lib_manager);

    // Create executor config parameter
    let executor_config = create_test_executor_config(executor);
    let config_param = create_executor_config_param(eid, executor_config);
    let params = array![config_param];

    // Mock the set_send_config call on the library
    start_mock_call(library, selector!("set_send_configs"), ());

    // Set the send config
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_send_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);
}

#[test]
#[fuzzer(runs: 1)]
fn should_set_send_config_with_multiple_params(
    owner: ContractAddress,
    library: ContractAddress,
    eid1: u32,
    eid2: u32,
    oapp: ContractAddress,
    executor: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Send);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(library);
    stop_cheat_caller_address(message_lib_manager);

    // Create multiple config parameters
    let uln_config = create_test_uln_config();
    let executor_config = create_test_executor_config(executor);
    let uln_param = create_uln_config_param(eid1, uln_config);
    let executor_param = create_executor_config_param(eid2, executor_config);
    let params = array![uln_param, executor_param];

    // Mock the set_send_config call on the library
    start_mock_call(library, selector!("set_send_configs"), ());

    // Set the send config
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_send_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_config_when_not_registered(
    owner: ContractAddress, unregistered_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Create config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Try to set config on unregistered library
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_configs(oapp, unregistered_library, params);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_registered_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_config_when_not_send_lib(
    owner: ContractAddress, library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type (not a send library)
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Create config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Try to set send config on receive library
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_send_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_send_config_when_not_authorized(
    owner: ContractAddress, library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Send);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Enable authorization throwing
    let mock_helpers = IMockManagerHelpersDispatcher { contract_address: message_lib_manager };
    mock_helpers.set_throw_on_authorize(true);

    // Create config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Try to set send config - should fail due to authorization
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_send_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_not_authorized());
}

// =============================== Test Set Receive Config =================================

#[test]
#[fuzzer(runs: 1)]
fn should_set_receive_config_with_uln_config(
    owner: ContractAddress, library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(library);
    stop_cheat_caller_address(message_lib_manager);

    // Create ULN config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Mock the set_receive_config call on the library
    start_mock_call(library, selector!("set_receive_configs"), ());

    // Set the receive config
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);
}

#[test]
#[fuzzer(runs: 1)]
fn should_set_receive_config_with_multiple_params(
    owner: ContractAddress, library: ContractAddress, eid1: u32, eid2: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    dispatcher.register_library(library);
    stop_cheat_caller_address(message_lib_manager);

    // Create multiple ULN config parameters
    let uln_config1 = create_test_uln_config();
    let uln_config2 = UlnConfig {
        confirmations: 20,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: false,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: false,
    };
    let param1 = create_uln_config_param(eid1, uln_config1);
    let param2 = create_uln_config_param(eid2, uln_config2);
    let params = array![param1, param2];

    // Mock the set_receive_config call on the library
    start_mock_call(library, selector!("set_receive_configs"), ());

    // Set the receive config
    start_cheat_caller_address(message_lib_manager, oapp);
    dispatcher.set_receive_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_config_when_not_registered(
    owner: ContractAddress, unregistered_library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Create config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Try to set config on unregistered library
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_configs(oapp, unregistered_library, params);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_registered_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_config_when_not_receive_lib(
    owner: ContractAddress, library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type (not a receive library)
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Send);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Create config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Try to set receive config on send library
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_only_receive_lib());
}

#[test]
#[fuzzer(runs: 1)]
#[feature("safe_dispatcher")]
fn should_fail_to_set_receive_config_when_not_authorized(
    owner: ContractAddress, library: ContractAddress, eid: u32, oapp: ContractAddress,
) {
    let MessageLibManagerMock {
        message_lib_manager, safe_dispatcher, ..,
    } = deploy_message_lib_manager(owner);

    // Mock call to message lib type
    start_mock_call(library, selector!("message_lib_type"), MessageLibType::Receive);

    // Register the library
    start_cheat_caller_address(message_lib_manager, owner);
    safe_dispatcher.register_library(library).unwrap();
    stop_cheat_caller_address(message_lib_manager);

    // Enable authorization throwing
    let mock_helpers = IMockManagerHelpersDispatcher { contract_address: message_lib_manager };
    mock_helpers.set_throw_on_authorize(true);

    // Create config parameter
    let uln_config = create_test_uln_config();
    let config_param = create_uln_config_param(eid, uln_config);
    let params = array![config_param];

    // Try to set receive config - should fail due to authorization
    start_cheat_caller_address(message_lib_manager, oapp);
    let res = safe_dispatcher.set_receive_configs(oapp, library, params);
    stop_cheat_caller_address(message_lib_manager);

    assert_panic_with_error(res, err_not_authorized());
}
