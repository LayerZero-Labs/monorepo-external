//! ULN admin tests

use core::num::traits::Zero;
use layerzero::message_lib::interface::{IMessageLibSafeDispatcher, IMessageLibSafeDispatcherTrait};
use layerzero::message_lib::uln_302::errors::{
    err_invalid_confirmations, err_invalid_optional_dvn_threshold, err_must_have_at_least_one_dvn,
    err_too_many_dvns, err_unsorted_dvns, err_unsupported_send_eid,
};
use layerzero::message_lib::uln_302::events::{
    DefaultExecutorConfigsSet, DefaultUlnReceiveConfigsSet, DefaultUlnSendConfigsSet,
    OAppExecutorConfigSet, OAppUlnReceiveConfigSet, OAppUlnSendConfigSet,
};
use layerzero::message_lib::uln_302::interface::{
    IUltraLightNode302AdminDispatcher, IUltraLightNode302AdminDispatcherTrait,
    IUltraLightNode302AdminSafeDispatcher, IUltraLightNode302AdminSafeDispatcherTrait,
};
use layerzero::message_lib::uln_302::structs::executor_config::{
    ExecutorConfig, SetDefaultExecutorConfigParam,
};
use layerzero::message_lib::uln_302::structs::uln_config::{SetDefaultUlnConfigParam, UlnConfig};
use layerzero::message_lib::uln_302::ultra_light_node_302::UltraLightNode302;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::message_lib::uln_302::utils::{
    create_executor_send_config_param, set_oapp_executor_send_config_via_message_lib,
    set_oapp_uln_receive_config_via_message_lib, set_oapp_uln_send_config_via_message_lib,
};
use super::utils::create_uln_send_config_param;


// Test constants
pub const ENDPOINT: ContractAddress = 'endpoint'.try_into().unwrap();
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const NON_OWNER: ContractAddress = 'non_owner'.try_into().unwrap();
pub const SENDER: ContractAddress = 'sender'.try_into().unwrap();
pub const SENDER_2: ContractAddress = 'sender_2'.try_into().unwrap();
pub const DVN_1: ContractAddress = 'dvn_1'.try_into().unwrap();
pub const DVN_2: ContractAddress = 'dvn_2'.try_into().unwrap();
pub const DVN_3: ContractAddress = 'dvn_3'.try_into().unwrap();
pub const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
pub const EXECUTOR_2: ContractAddress = 'executor_2'.try_into().unwrap();
pub const DST_EID: u32 = 2;
pub const DST_EID_2: u32 = 3;
pub const MAX_MESSAGE_SIZE: u32 = 100;
pub const CONFIRMATIONS: u64 = 20;
pub const TREASURY_FEE: u256 = 300;
pub const TREASURY_NATIVE_FEE_CAP: u256 = 100;

// Helper functions
fn deploy_ultra_light_node_302() -> (IUltraLightNode302AdminDispatcher, ContractAddress) {
    let contract = declare("UltraLightNode302").unwrap_syscall().contract_class();
    let treasury = deploy_mock_treasury(TREASURY_FEE);
    let mut constructor_calldata = array![OWNER.into(), treasury.into(), ENDPOINT.into()];
    TREASURY_NATIVE_FEE_CAP.serialize(ref constructor_calldata);
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    let admin = IUltraLightNode302AdminDispatcher { contract_address };
    (admin, contract_address)
}

fn deploy_ultra_light_node_302_safe() -> (IUltraLightNode302AdminSafeDispatcher, ContractAddress) {
    let contract = declare("UltraLightNode302").unwrap_syscall().contract_class();
    let treasury = deploy_mock_treasury(TREASURY_FEE);
    let mut constructor_calldata = array![OWNER.into(), treasury.into(), ENDPOINT.into()];
    TREASURY_NATIVE_FEE_CAP.serialize(ref constructor_calldata);
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    let admin = IUltraLightNode302AdminSafeDispatcher { contract_address };
    (admin, contract_address)
}

fn deploy_mock_treasury(treasury_fee: u256) -> ContractAddress {
    let contract = declare("MockTreasury").unwrap_syscall().contract_class();
    let constructor_calldata = array![treasury_fee.low.into(), treasury_fee.high.into()];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    address
}

fn create_required_dvns() -> Array<ContractAddress> {
    array![DVN_1, DVN_2]
}

fn create_optional_dvns() -> Array<ContractAddress> {
    array![]
}

fn create_test_uln_config() -> UlnConfig {
    UlnConfig {
        confirmations: CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: create_required_dvns(),
        has_required_dvns: true,
        optional_dvns: create_optional_dvns(),
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    }
}

fn create_test_executor_config() -> ExecutorConfig {
    ExecutorConfig { max_message_size: MAX_MESSAGE_SIZE, executor: EXECUTOR }
}

// Helper function to set up default config for an EID (makes EID supported)
fn setup_default_config(
    admin: IUltraLightNode302AdminDispatcher, contract_address: ContractAddress, dst_eid: u32,
) {
    let default_config = create_test_uln_config();
    let config_params = array![SetDefaultUlnConfigParam { eid: dst_eid, config: default_config }];

    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);
}

// Helper function to set up default config for safe dispatcher tests
fn setup_default_config_for_safe_test(contract_address: ContractAddress, dst_eid: u32) {
    let admin_regular = IUltraLightNode302AdminDispatcher { contract_address };
    setup_default_config(admin_regular, contract_address, dst_eid);
}

// Test cases for admin functions
#[test]
fn test_owner_can_set_default_uln_send_configs() {
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let uln_config = create_test_uln_config();

    // Create array of configs for the new API
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: uln_config.clone() },
    ];

    let mut spy = spy_events();

    // Test that owner can set default config
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    // Verify config was set
    let retrieved_uln_config = admin.get_default_uln_send_config(DST_EID);

    assert(retrieved_uln_config.confirmations == CONFIRMATIONS, 'ULN confirmations incorrect');
    assert(
        retrieved_uln_config.required_dvns.len() == create_required_dvns().len(),
        'ULN DVNs count incorrect',
    );

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DefaultUlnSendConfigsSet(
                        DefaultUlnSendConfigsSet {
                            params: array![
                                SetDefaultUlnConfigParam { eid: DST_EID, config: uln_config },
                            ],
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_owner_can_set_default_executor_configs() {
    const MAX_MESSAGE_SIZE_2: u32 = 10;
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let executor_config_1 = ExecutorConfig {
        max_message_size: MAX_MESSAGE_SIZE, executor: EXECUTOR,
    };
    let executor_config_2 = ExecutorConfig {
        max_message_size: MAX_MESSAGE_SIZE_2, executor: EXECUTOR_2,
    };

    let mut spy = spy_events();

    // Test that owner can set default executor config
    cheat_caller_address_once(contract_address, OWNER);
    admin
        .set_default_executor_configs(
            array![
                SetDefaultExecutorConfigParam {
                    dst_eid: DST_EID, config: executor_config_1.clone(),
                },
                SetDefaultExecutorConfigParam {
                    dst_eid: DST_EID_2, config: executor_config_2.clone(),
                },
            ],
        );

    // Verify config was set
    let retrieved_executor_config_1 = admin.get_default_executor_config(DST_EID);

    assert(
        retrieved_executor_config_1.max_message_size == MAX_MESSAGE_SIZE,
        'Executor 1 size incorrect',
    );
    assert(retrieved_executor_config_1.executor == EXECUTOR, 'Executor 1 address incorrect');

    let retrieved_executor_config_2 = admin.get_default_executor_config(DST_EID_2);
    assert(
        retrieved_executor_config_2.max_message_size == MAX_MESSAGE_SIZE_2,
        'Executor 2 size incorrect',
    );
    assert(retrieved_executor_config_2.executor == EXECUTOR_2, 'Executor 2 address incorrect');

    // Verify events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DefaultExecutorConfigsSet(
                        DefaultExecutorConfigsSet {
                            params: array![
                                SetDefaultExecutorConfigParam {
                                    dst_eid: DST_EID, config: executor_config_1,
                                },
                                SetDefaultExecutorConfigParam {
                                    dst_eid: DST_EID_2, config: executor_config_2,
                                },
                            ],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: ('Caller is not the owner',))]
fn test_non_owner_cannot_set_default_uln_send_configs() {
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let uln_config = create_test_uln_config();
    let config_params = array![SetDefaultUlnConfigParam { eid: DST_EID, config: uln_config }];

    cheat_caller_address_once(contract_address, NON_OWNER);
    admin.set_default_uln_send_configs(config_params);
}

#[test]
#[should_panic(expected: ('Caller is not the owner',))]
fn test_non_owner_cannot_set_default_executor_configs() {
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let executor_config = create_test_executor_config();

    cheat_caller_address_once(contract_address, NON_OWNER);
    admin
        .set_default_executor_configs(
            array![SetDefaultExecutorConfigParam { dst_eid: DST_EID, config: executor_config }],
        );
}

#[test]
fn test_set_and_get_default_uln_send_config_multiple_destinations() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // Set configs for different destinations
    let config_dst2 = UlnConfig {
        confirmations: 5,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let config_dst3 = UlnConfig {
        confirmations: 15,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    // Use the new batch API to set multiple configs at once
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_dst2.clone() },
        SetDefaultUlnConfigParam { eid: DST_EID_2, config: config_dst3.clone() },
    ];

    let mut spy = spy_events();

    // Owner sets default send configs
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    // Verify different configs for different destinations
    let retrieved_config_dst2 = admin.get_default_uln_send_config(DST_EID);
    let retrieved_config_dst3 = admin.get_default_uln_send_config(DST_EID_2);

    assert(
        retrieved_config_dst2.confirmations == config_dst2.confirmations,
        'DST2 confirmations incorrect',
    );
    assert(
        retrieved_config_dst2.required_dvns.len() == config_dst2.required_dvns.len(),
        'DST2 DVNs count incorrect',
    );
    assert(
        retrieved_config_dst3.confirmations == config_dst3.confirmations,
        'DST3 confirmations incorrect',
    );
    assert(
        retrieved_config_dst3.required_dvns.len() == config_dst3.required_dvns.len(),
        'DST3 DVNs count incorrect',
    );

    // Verify events were emitted for both configs
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DefaultUlnSendConfigsSet(
                        DefaultUlnSendConfigsSet {
                            params: array![
                                SetDefaultUlnConfigParam { eid: DST_EID, config: config_dst2 },
                                SetDefaultUlnConfigParam { eid: DST_EID_2, config: config_dst3 },
                            ],
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_set_and_get_default_executor_config_multiple_destinations() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // Set configs for different destinations
    let config_dst2 = ExecutorConfig { max_message_size: 500, executor: EXECUTOR };
    let config_dst3 = ExecutorConfig { max_message_size: 2000, executor: EXECUTOR_2 };

    cheat_caller_address_once(contract_address, OWNER);
    admin
        .set_default_executor_configs(
            array![
                SetDefaultExecutorConfigParam { dst_eid: DST_EID, config: config_dst2.clone() },
                SetDefaultExecutorConfigParam { dst_eid: DST_EID_2, config: config_dst3.clone() },
            ],
        );

    // Verify different configs for different destinations
    let retrieved_config_dst2 = admin.get_default_executor_config(DST_EID);
    let retrieved_config_dst3 = admin.get_default_executor_config(DST_EID_2);

    assert(
        retrieved_config_dst2.max_message_size == config_dst2.max_message_size,
        'DST2 size incorrect',
    );
    assert(retrieved_config_dst2.executor == EXECUTOR, 'DST2 executor incorrect');
    assert(
        retrieved_config_dst3.max_message_size == config_dst3.max_message_size,
        'DST3 size incorrect',
    );
    assert(retrieved_config_dst3.executor == EXECUTOR_2, 'DST3 executor incorrect');
}

#[test]
fn test_set_and_get_raw_oapp_uln_send_config_multiple_senders() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // First set default config as owner (required for EID to be supported)
    setup_default_config(admin, contract_address, DST_EID);

    // Set configs for different senders (no ownership required)
    let config_sender1 = UlnConfig {
        confirmations: 8,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let config_sender2 = UlnConfig {
        confirmations: 12,
        has_confirmations: true,
        required_dvns: array![DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let mut spy = spy_events();

    // Set config for SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, config_sender1.clone(),
    );

    // Set config for SENDER_2
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER_2, DST_EID, config_sender2.clone(),
    );

    // Verify different configs for different senders
    let retrieved_config_sender1 = admin.get_raw_oapp_uln_send_config(SENDER, DST_EID);
    let retrieved_config_sender2 = admin.get_raw_oapp_uln_send_config(SENDER_2, DST_EID);

    assert(
        retrieved_config_sender1.confirmations == config_sender1.confirmations,
        'Sender1 confirmations incorrect',
    );
    assert(
        retrieved_config_sender2.confirmations == config_sender2.confirmations,
        'Sender2 confirmations incorrect',
    );

    // Verify events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnSendConfigSet(
                        OAppUlnSendConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: config_sender1,
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnSendConfigSet(
                        OAppUlnSendConfigSet {
                            oapp: SENDER_2, dst_eid: DST_EID, config: config_sender2,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_set_and_get_raw_oapp_executor_config_multiple_senders() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // First set default config as owner (required for EID to be supported)
    setup_default_config(admin, contract_address, DST_EID);

    // Set configs for different senders
    let config_sender1 = ExecutorConfig { max_message_size: 800, executor: EXECUTOR };
    let config_sender2 = ExecutorConfig { max_message_size: 1200, executor: EXECUTOR_2 };

    let mut spy = spy_events();

    // Set config for SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, config_sender1.clone(),
    );

    // Set config for SENDER_2
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER_2, DST_EID, config_sender2.clone(),
    );

    // Verify different configs for different senders
    let retrieved_config_sender1 = admin.get_raw_oapp_executor_config(SENDER, DST_EID);
    let retrieved_config_sender2 = admin.get_raw_oapp_executor_config(SENDER_2, DST_EID);

    assert(
        retrieved_config_sender1.max_message_size == config_sender1.max_message_size,
        'Sender1 size incorrect',
    );
    assert(retrieved_config_sender1.executor == EXECUTOR, 'Sender1 executor incorrect');
    assert(
        retrieved_config_sender2.max_message_size == config_sender2.max_message_size,
        'Sender2 size incorrect',
    );
    assert(retrieved_config_sender2.executor == EXECUTOR_2, 'Sender2 executor incorrect');

    // Verify events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppExecutorConfigSet(
                        OAppExecutorConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: config_sender1,
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::OAppExecutorConfigSet(
                        OAppExecutorConfigSet {
                            oapp: SENDER_2, dst_eid: DST_EID, config: config_sender2,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_oapp_config_overrides_default() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // Set default config
    let default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![DVN_3],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: default_config.clone() },
    ];

    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    // Set OApp-specific config that should override default
    let oapp_config = UlnConfig {
        confirmations: 20,
        has_confirmations: true,
        required_dvns: array![DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let mut spy = spy_events();

    // Set config as SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, oapp_config.clone(),
    );

    // Verify that default and OApp effective configs are different
    let oapp_effective_config = admin.get_oapp_uln_send_config(SENDER, DST_EID);
    assert(
        oapp_effective_config.confirmations == oapp_config.confirmations,
        'OApp confirmations incorrect',
    );
    assert(
        oapp_effective_config.required_dvns.len() == oapp_config.required_dvns.len(),
        'OApp DVNs count incorrect',
    );
    assert(
        *oapp_effective_config.required_dvns.at(0) == *oapp_config.required_dvns.at(0),
        'OApp DVN incorrect',
    );

    // Check that a different sender would get the default config (not overridden)
    let other_sender_effective_config = admin.get_oapp_uln_send_config(SENDER_2, DST_EID);
    assert(
        other_sender_effective_config.confirmations == default_config.confirmations,
        'Other sender should get default',
    );
    assert(
        *other_sender_effective_config.required_dvns.at(0) == *default_config.required_dvns.at(0),
        'Sender2 should get default DVN',
    );

    // Verify OApp config event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnSendConfigSet(
                        OAppUlnSendConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: oapp_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_oapp_config_partial_override() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // Set default config with all fields populated
    let default_config = UlnConfig {
        confirmations: 15,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: true,
        optional_dvns: array![DVN_3],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: default_config.clone() },
    ];

    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    // Set OApp-specific config that only overrides some fields
    let partial_oapp_config = UlnConfig {
        confirmations: 25, // Override confirmations
        has_confirmations: true,
        required_dvns: array![], // Don't override required DVNs (use default)
        has_required_dvns: false, // This means use default
        optional_dvns: array![DVN_1, DVN_2], // Override optional DVNs
        optional_dvn_threshold: 2, // Override optional threshold
        has_optional_dvns: true,
    };

    let mut spy = spy_events();

    // Set config as SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, partial_oapp_config.clone(),
    );

    // Get the effective config (resolved)
    let effective_config = admin.get_oapp_uln_send_config(SENDER, DST_EID);

    // Verify partial override behavior:
    // - confirmations should be overridden (25, not 15)
    // - required_dvns should use default (DVN_1, DVN_2 from default, not empty from oapp)
    // - optional_dvns should be overridden (DVN_1, DVN_2 from oapp, not DVN_3 from default)
    // - optional_dvn_threshold should be overridden (2, not 1)

    assert(
        effective_config.confirmations == partial_oapp_config.confirmations,
        'Confirmations not overridden',
    );
    assert(
        effective_config.required_dvns.len() == default_config.required_dvns.len(),
        'Required DVNs not default',
    );
    assert(
        *effective_config.required_dvns.at(0) == *default_config.required_dvns.at(0),
        'Required DVN[0] not default',
    );
    assert(
        *effective_config.required_dvns.at(1) == *default_config.required_dvns.at(1),
        'Required DVN[1] not default',
    );
    assert(
        effective_config.optional_dvns.len() == partial_oapp_config.optional_dvns.len(),
        'Optional DVNs not overridden',
    );
    assert(
        *effective_config.optional_dvns.at(0) == *partial_oapp_config.optional_dvns.at(0),
        'Optional DVN[0] not overridden',
    );
    assert(
        *effective_config.optional_dvns.at(1) == *partial_oapp_config.optional_dvns.at(1),
        'Optional DVN[1] not overridden',
    );
    assert(
        effective_config.optional_dvn_threshold == partial_oapp_config.optional_dvn_threshold,
        'Optional thresh not overridden',
    );

    // Verify that another sender gets the full default config
    let other_sender_effective_config = admin.get_oapp_uln_send_config(SENDER_2, DST_EID);
    assert(
        other_sender_effective_config.confirmations == default_config.confirmations,
        'Sender2 confms != default',
    );
    assert(
        other_sender_effective_config.required_dvns.len() == default_config.required_dvns.len(),
        'Sender2 reqDVNs != default',
    );
    assert(
        other_sender_effective_config.optional_dvns.len() == default_config.optional_dvns.len(),
        'Sender2 optDVNs != default',
    );
    assert(
        *other_sender_effective_config.optional_dvns.at(0) == *default_config.optional_dvns.at(0),
        'Sender2 optDVN != default',
    );
    assert(
        other_sender_effective_config
            .optional_dvn_threshold == default_config
            .optional_dvn_threshold,
        'Sender2 thresh != default',
    );

    // Verify OApp config event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnSendConfigSet(
                        OAppUlnSendConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: partial_oapp_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_oapp_config_partial_override_with_false_has_flags() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // Set default config with all fields populated
    let default_config = UlnConfig {
        confirmations: 15,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: true,
        optional_dvns: array![DVN_3],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: default_config.clone() },
    ];

    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    // Set OApp-specific config with has_required_dvns = false
    // Even if we provide values in required_dvns, they should be ignored
    let partial_oapp_config = UlnConfig {
        confirmations: 25, // Override confirmations
        has_confirmations: true,
        required_dvns: array![DVN_3], // This should be ignored since has_required_dvns = false
        has_required_dvns: false, // This means use default required DVNs
        optional_dvns: array![], // Don't override optional DVNs (use default)
        optional_dvn_threshold: 0, // Don't override optional threshold (use default)
        has_optional_dvns: false // This means use default optional DVNs
    };

    let mut spy = spy_events();

    // Set config as SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, partial_oapp_config.clone(),
    );

    // Get the effective config (resolved)
    let effective_config = admin.get_oapp_uln_send_config(SENDER, DST_EID);

    // Verify that when has_required_dvns = false, the default required DVNs are used
    // NOT the values provided in the OApp config's required_dvns array
    assert(
        effective_config.confirmations == partial_oapp_config.confirmations,
        'Confirmations not overridden',
    );
    assert(
        effective_config.required_dvns.len() == default_config.required_dvns.len(),
        'RequiredDVNs dont default',
    );
    assert(
        *effective_config.required_dvns.at(0) == *default_config.required_dvns.at(0),
        'Required DVN[0] not default',
    );
    assert(
        *effective_config.required_dvns.at(1) == *default_config.required_dvns.at(1),
        'Required DVN[1] not default',
    );
    // Verify that the OApp config's required_dvns values were ignored
    assert(
        *effective_config.required_dvns.at(0) != *partial_oapp_config.required_dvns.at(0),
        'OApp required DVNs not ignored',
    );

    // Verify that optional DVNs also use default when has_optional_dvns = false
    assert(
        effective_config.optional_dvns.len() == default_config.optional_dvns.len(),
        'Optional DVNs not default',
    );
    assert(
        *effective_config.optional_dvns.at(0) == *default_config.optional_dvns.at(0),
        'Optional DVN not default',
    );
    assert(
        effective_config.optional_dvn_threshold == default_config.optional_dvn_threshold,
        'Optional threshold not default',
    );

    // Verify that another sender gets the same default config
    let other_sender_effective_config = admin.get_oapp_uln_send_config(SENDER_2, DST_EID);
    assert(
        other_sender_effective_config.confirmations == default_config.confirmations,
        'Sender2 confms != default',
    );
    assert(
        other_sender_effective_config.required_dvns.len() == default_config.required_dvns.len(),
        'Sender2 reqDVNs != default',
    );

    // Verify OApp config event was emitted with the original config (including ignored values)
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnSendConfigSet(
                        OAppUlnSendConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: partial_oapp_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_treasury_getter() {
    let (admin, _) = deploy_ultra_light_node_302();

    let treasury = admin.get_treasury();
    assert(treasury.is_non_zero(), 'Treasury should be set');
}

#[test]
fn test_empty_configs_return_defaults() {
    let (admin, _) = deploy_ultra_light_node_302();

    // Getting configs that were never set should return empty/default values
    let empty_uln_config = admin.get_default_uln_send_config(DST_EID);
    let empty_executor_config = admin.get_default_executor_config(DST_EID);
    let empty_oapp_uln_config = admin.get_raw_oapp_uln_send_config(SENDER, DST_EID);
    let empty_oapp_executor_config = admin.get_raw_oapp_executor_config(SENDER, DST_EID);

    // These should be empty/default values
    assert(empty_uln_config.confirmations == 0, 'Default ULN should be empty');
    assert(empty_uln_config.required_dvns.len() == 0, 'Default ULN dvns != empty');
    assert(empty_executor_config.max_message_size == 0, 'Default executor != empty');
    assert(empty_oapp_uln_config.confirmations == 0, 'OApp ULN should be empty');
    assert(empty_oapp_executor_config.max_message_size == 0, 'OApp executor should be empty');
}

#[test]
#[feature("safe_dispatcher")]
fn test_cannot_set_oapp_uln_send_config_without_default_config() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();
    let uln_config = create_test_uln_config();

    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, uln_config);

    // Try to set OApp config without setting default config first
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);

    assert_panic_with_error(result, err_unsupported_send_eid(DST_EID));
}

#[test]
#[feature("safe_dispatcher")]
fn test_cannot_set_oapp_executor_config_without_default_config() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();
    let executor_config = create_test_executor_config();

    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_executor_send_config_param(DST_EID, executor_config);

    // Try to set OApp executor config without setting default config first
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);

    assert_panic_with_error(result, err_unsupported_send_eid(DST_EID));
}

#[test]
fn test_eid_with_optional_dvn_threshold_is_supported() {
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let uln_config = create_test_uln_config();
    let default_config_with_optional = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![], // No required DVNs
        has_required_dvns: true,
        optional_dvns: array![DVN_1, DVN_2], // Has optional DVNs
        optional_dvn_threshold: 1, // Has optional threshold > 0
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: default_config_with_optional },
    ];

    // Set default config with only optional DVN threshold (no required DVNs)
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    // Should be able to set OApp config because EID is supported (has optional threshold > 0)
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(contract_address, SENDER, DST_EID, uln_config.clone());

    // Verify config was set
    let retrieved_config = admin.get_raw_oapp_uln_send_config(SENDER, DST_EID);
    assert(
        retrieved_config.confirmations == uln_config.confirmations, 'OApp config not set correctly',
    );
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_duplicate_required_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with duplicate required DVNs
    let config_with_duplicate_required = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_1], // Duplicate DVN_1
        has_required_dvns: true,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_duplicate_required },
    ];

    // Try to set default config with duplicate required DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_duplicate_optional_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with duplicate optional DVNs
    let config_with_duplicate_optional = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![DVN_2, DVN_2], // Duplicate DVN_2
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_duplicate_optional },
    ];

    // Try to set default config with duplicate optional DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_unsorted_required_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with unsorted required DVNs (DVN_2 < DVN_1)
    let config_with_unsorted_required = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_2, DVN_1], // Unsorted: DVN_2 should come after DVN_1
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_unsorted_required },
    ];

    // Try to set default config with unsorted required DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_unsorted_optional_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with unsorted optional DVNs (DVN_2 < DVN_1)
    let config_with_unsorted_optional = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns: array![DVN_2, DVN_1], // Unsorted: DVN_2 should come after DVN_1
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_unsorted_optional },
    ];

    // Try to set default config with unsorted optional DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_invalid_optional_threshold() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with invalid optional threshold (threshold > optional DVN count)
    let config_with_invalid_threshold = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns: array![DVN_1], // Only 1 optional DVN
        optional_dvn_threshold: 2, // But threshold is 2
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_invalid_threshold },
    ];

    // Try to set default config with invalid optional threshold - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_invalid_optional_dvn_threshold(1, 2));
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_zero_threshold_but_optional_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with optional DVNs but zero threshold
    let config_with_zero_threshold = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns: array![DVN_1, DVN_2], // Has optional DVNs
        optional_dvn_threshold: 0, // But threshold is 0
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_zero_threshold },
    ];

    // Try to set default config with zero threshold but optional DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_invalid_optional_dvn_threshold(2, 0));
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_too_many_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with too many DVNs (exceeding MAX_DVN_COUNT = 255)
    let mut too_many_required_dvns = array![];
    let mut too_many_optional_dvns = array![];

    // Add 200 required DVNs
    let mut i = 1;
    while i != 201 {
        too_many_required_dvns.append(i.try_into().unwrap());
        i += 1;
    }

    // Add 100 optional DVNs (total = 300 > 255)
    let mut j = 202;
    while j != 302 {
        too_many_optional_dvns.append(j.try_into().unwrap());
        j += 1;
    }

    let config_with_too_many_dvns = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: too_many_required_dvns,
        has_required_dvns: true,
        optional_dvns: too_many_optional_dvns,
        optional_dvn_threshold: 50,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_too_many_dvns },
    ];

    // Try to set default config with too many DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_too_many_dvns(200, 100));
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_zero_confirmations() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with zero confirmations
    let config_with_zero_confirmations = UlnConfig {
        confirmations: 0, // Invalid: confirmations must be > 0
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_zero_confirmations },
    ];

    // Try to set default config with zero confirmations - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_invalid_confirmations());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_send_config_fails_with_no_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with no DVNs and no optional threshold
    let config_with_no_dvns = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![], // No required DVNs
        has_required_dvns: true,
        optional_dvns: array![], // No optional DVNs
        optional_dvn_threshold: 0, // No optional threshold
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_no_dvns },
    ];

    // Try to set default config with no DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_send_configs(config_params);
    assert_panic_with_error(result, err_must_have_at_least_one_dvn());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_with_duplicate_required_dvns() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();

    // First set default config as owner (required for EID to be supported)
    setup_default_config_for_safe_test(contract_address, DST_EID);

    // Create config with duplicate required DVNs
    let config_with_duplicate_required = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_1], // Duplicate DVN_1
        has_required_dvns: true,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, config_with_duplicate_required);

    // Try to set OApp config with duplicate required DVNs - should fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_with_duplicate_optional_dvns() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();

    // First set default config as owner (required for EID to be supported)
    setup_default_config_for_safe_test(contract_address, DST_EID);

    // Create config with duplicate optional DVNs
    let config_with_duplicate_optional = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![DVN_2, DVN_2], // Duplicate DVN_2
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, config_with_duplicate_optional);

    // Try to set OApp config with duplicate optional DVNs - should fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_with_unsorted_required_dvns() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();

    // First set default config as owner (required for EID to be supported)
    setup_default_config_for_safe_test(contract_address, DST_EID);

    // Create config with unsorted required DVNs (DVN_2 < DVN_1)
    let config_with_unsorted_required = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_2, DVN_1], // Unsorted: DVN_2 should come after DVN_1
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };
    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, config_with_unsorted_required);

    // Try to set OApp config with unsorted required DVNs - should fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_with_unsorted_optional_dvns() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();

    // First set default config as owner (required for EID to be supported)
    setup_default_config_for_safe_test(contract_address, DST_EID);

    // Create config with unsorted optional DVNs (DVN_2 < DVN_1)
    let config_with_unsorted_optional = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns: array![DVN_2, DVN_1], // Unsorted: DVN_2 should come after DVN_1
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, config_with_unsorted_optional);

    // Try to set OApp config with unsorted optional DVNs - should fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_when_resolved_config_has_no_dvns_and_default_has_required() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();
    let admin_regular = IUltraLightNode302AdminDispatcher { contract_address };
    let invalid_default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_1], // Default DVNs set, will get overwritten
        has_required_dvns: true,
        optional_dvns: array![DVN_3], // Optional DVNs set, will get overwritten
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: invalid_default_config },
    ];

    // Set default config with no DVNs and no threshold
    cheat_caller_address_once(contract_address, OWNER);
    admin_regular.set_default_uln_send_configs(config_params);

    // Try to set OApp config that also has no DVNs - should fail during resolution
    let oapp_config_no_dvns = UlnConfig {
        confirmations: 20,
        has_confirmations: true,
        required_dvns: array![], // No required DVNs
        has_required_dvns: true,
        optional_dvns: array![], // No optional DVNs
        optional_dvn_threshold: 0, // No optional threshold
        has_optional_dvns: true,
    };
    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, oapp_config_no_dvns);

    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(result, err_must_have_at_least_one_dvn());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_when_resolved_config_has_no_dvns_and_default_has_optional() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();
    let admin_regular = IUltraLightNode302AdminDispatcher { contract_address };
    let invalid_default_config = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![], // Default DVNs set, will get overwritten
        has_required_dvns: true,
        optional_dvns: array![DVN_3], // Optional DVNs set, will get overwritten
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: invalid_default_config },
    ];

    // Set default config with no DVNs and no threshold
    cheat_caller_address_once(contract_address, OWNER);
    admin_regular.set_default_uln_send_configs(config_params);

    let oapp_config_no_dvns = UlnConfig {
        confirmations: 20,
        has_confirmations: true,
        required_dvns: array![], // No required DVNs
        has_required_dvns: true,
        optional_dvns: array![], // No optional DVNs
        optional_dvn_threshold: 0, // No optional threshold
        has_optional_dvns: true,
    };

    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, oapp_config_no_dvns);

    // Try to set OApp config that also has no DVNs - should fail during resolution
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(result, err_must_have_at_least_one_dvn());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_with_invalid_optional_threshold() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();

    // First set default config as owner (required for EID to be supported)
    setup_default_config_for_safe_test(contract_address, DST_EID);

    // Create config with invalid optional threshold (threshold > optional DVN count)
    let config_with_invalid_threshold = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns: array![DVN_1], // Only 1 optional DVN
        optional_dvn_threshold: 2, // But threshold is 2
        has_optional_dvns: true,
    };
    let optional_dvns_num = config_with_invalid_threshold.optional_dvns.len();
    let optional_dvn_threshold = config_with_invalid_threshold.optional_dvn_threshold;

    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, config_with_invalid_threshold);

    // Try to set OApp config with invalid optional threshold - should fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(
        result, err_invalid_optional_dvn_threshold(optional_dvns_num, optional_dvn_threshold),
    );
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_with_zero_threshold_but_optional_dvns() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();

    // First set default config as owner (required for EID to be supported)
    setup_default_config_for_safe_test(contract_address, DST_EID);

    // Create config with optional DVNs but zero threshold
    let config_with_zero_threshold = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: array![DVN_3],
        has_required_dvns: true,
        optional_dvns: array![DVN_1, DVN_2], // Has optional DVNs
        optional_dvn_threshold: 0, // But threshold is 0
        has_optional_dvns: true,
    };
    let optional_dvns_num = config_with_zero_threshold.optional_dvns.len();
    let optional_dvn_threshold = config_with_zero_threshold.optional_dvn_threshold;

    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, config_with_zero_threshold);

    // Try to set OApp config with zero threshold but optional DVNs - should fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(
        result, err_invalid_optional_dvn_threshold(optional_dvns_num, optional_dvn_threshold),
    );
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_oapp_uln_send_config_fails_with_too_many_dvns() {
    let (_, contract_address) = deploy_ultra_light_node_302_safe();

    // First set default config as owner (required for EID to be supported)
    setup_default_config_for_safe_test(contract_address, DST_EID);

    // Create config with too many DVNs (exceeding MAX_DVN_COUNT = 255)
    let mut too_many_required_dvns = array![];
    let mut too_many_optional_dvns = array![];

    // Add 200 required DVNs
    let mut i = 1;
    while i != 201 {
        too_many_required_dvns.append(i.try_into().unwrap());
        i += 1;
    }

    // Add 100 optional DVNs (total = 300 > 255)
    let mut j = 202;
    while j != 302 {
        too_many_optional_dvns.append(j.try_into().unwrap());
        j += 1;
    }

    let required_dvns_num = too_many_required_dvns.len();
    let optional_dvns_num = too_many_optional_dvns.len();
    let config_with_too_many_dvns = UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns: too_many_required_dvns,
        has_required_dvns: true,
        optional_dvns: too_many_optional_dvns,
        optional_dvn_threshold: 50,
        has_optional_dvns: true,
    };
    let message_lib = IMessageLibSafeDispatcher { contract_address };
    let param = create_uln_send_config_param(DST_EID, config_with_too_many_dvns);

    // Try to set OApp config with too many DVNs - should fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib.set_send_configs(SENDER, array![param]);
    assert_panic_with_error(result, err_too_many_dvns(required_dvns_num, optional_dvns_num));
}

#[test]
fn test_set_oapp_uln_send_config_success_with_valid_config() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // First set default config as owner (required for EID to be supported)
    setup_default_config(admin, contract_address, DST_EID);

    // Create a valid config
    let valid_config = UlnConfig {
        confirmations: 15,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };

    let mut spy = spy_events();

    // Set OApp config - should succeed
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, valid_config.clone(),
    );

    // Verify config was set correctly
    let retrieved_config = admin.get_raw_oapp_uln_send_config(SENDER, DST_EID);
    assert(
        retrieved_config.confirmations == valid_config.confirmations,
        'Confirmations not set correctly',
    );
    assert(
        retrieved_config.required_dvns.len() == valid_config.required_dvns.len(),
        'Required DVNs not set correctly',
    );
    assert(
        retrieved_config.optional_dvns.len() == valid_config.optional_dvns.len(),
        'Optional DVNs not set correctly',
    );
    assert(
        retrieved_config.optional_dvn_threshold == valid_config.optional_dvn_threshold,
        'Optional threshold incorrect',
    );

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnSendConfigSet(
                        OAppUlnSendConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: valid_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_set_oapp_executor_config_success_with_valid_config() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // First set default config as owner (required for EID to be supported)
    setup_default_config(admin, contract_address, DST_EID);

    // Create a valid executor config
    let valid_executor_config = ExecutorConfig { max_message_size: 2000, executor: EXECUTOR };

    let mut spy = spy_events();

    // Set OApp executor config - should succeed
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, valid_executor_config.clone(),
    );

    // Verify config was set correctly
    let retrieved_config = admin.get_raw_oapp_executor_config(SENDER, DST_EID);
    assert(
        retrieved_config.max_message_size == valid_executor_config.max_message_size,
        'MaxMsgSize not set correctly',
    );
    assert(
        retrieved_config.executor == valid_executor_config.executor, 'Executor not set correctly',
    );

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppExecutorConfigSet(
                        OAppExecutorConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: valid_executor_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_set_oapp_configs_emits_correct_events() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // First set default config as owner (required for EID to be supported)
    setup_default_config(admin, contract_address, DST_EID);

    let uln_config = UlnConfig {
        confirmations: 25,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let executor_config = ExecutorConfig { max_message_size: 3000, executor: EXECUTOR };

    let mut spy = spy_events();

    // Set both configs as SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(contract_address, SENDER, DST_EID, uln_config.clone());

    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, executor_config.clone(),
    );

    // Verify both events were emitted with correct data
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnSendConfigSet(
                        OAppUlnSendConfigSet { oapp: SENDER, dst_eid: DST_EID, config: uln_config },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::OAppExecutorConfigSet(
                        OAppExecutorConfigSet {
                            oapp: SENDER, dst_eid: DST_EID, config: executor_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_set_oapp_configs_multiple_callers_independence() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // First set default config as owner (required for EID to be supported)
    setup_default_config(admin, contract_address, DST_EID);

    let sender1_uln_config = UlnConfig {
        confirmations: 30,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let sender2_uln_config = UlnConfig {
        confirmations: 40,
        has_confirmations: true,
        required_dvns: array![DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let sender1_executor_config = ExecutorConfig { max_message_size: 4000, executor: DVN_1 };
    let sender2_executor_config = ExecutorConfig { max_message_size: 5000, executor: DVN_2 };

    // Set configs for SENDER
    start_cheat_caller_address(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, sender1_uln_config.clone(),
    );
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, sender1_executor_config.clone(),
    );

    set_oapp_uln_send_config_via_message_lib(
        contract_address, SENDER_2, DST_EID, sender2_uln_config.clone(),
    );
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER_2, DST_EID, sender2_executor_config.clone(),
    );
    stop_cheat_caller_address(contract_address);

    // Verify configs are independent
    let sender1_retrieved_uln = admin.get_raw_oapp_uln_send_config(SENDER, DST_EID);
    let sender2_retrieved_uln = admin.get_raw_oapp_uln_send_config(SENDER_2, DST_EID);
    let sender1_retrieved_executor = admin.get_raw_oapp_executor_config(SENDER, DST_EID);
    let sender2_retrieved_executor = admin.get_raw_oapp_executor_config(SENDER_2, DST_EID);

    assert(sender1_retrieved_uln.confirmations == 30, 'Sender1 ULN confirmations wrong');
    assert(sender2_retrieved_uln.confirmations == 40, 'Sender2 ULN confirmations wrong');
    assert(sender1_retrieved_executor.max_message_size == 4000, 'Sender1 executor size wrong');
    assert(sender2_retrieved_executor.max_message_size == 5000, 'Sender2 executor size wrong');
    assert(sender1_retrieved_executor.executor == DVN_1, 'Sender1 executor address wrong');
    assert(sender2_retrieved_executor.executor == DVN_2, 'Sender2 executor address wrong');
}

#[test]
fn test_owner_can_set_default_uln_receive_configs() {
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let uln_config = create_test_uln_config();

    // Create array of configs for the new API
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: uln_config.clone() },
    ];

    let mut spy = spy_events();

    // Test that owner can set default receive configs
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_receive_configs(config_params);

    // Verify config was set
    let retrieved_uln_config = admin.get_default_uln_receive_config(DST_EID);

    assert(retrieved_uln_config.confirmations == CONFIRMATIONS, 'Receive confirmations incorrect');
    assert(
        retrieved_uln_config.required_dvns.len() == create_required_dvns().len(),
        'Receive DVNs count incorrect',
    );

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DefaultUlnReceiveConfigsSet(
                        DefaultUlnReceiveConfigsSet {
                            params: array![
                                SetDefaultUlnConfigParam { eid: DST_EID, config: uln_config },
                            ],
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[should_panic(expected: ('Caller is not the owner',))]
fn test_non_owner_cannot_set_default_uln_receive_configs() {
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let uln_config = create_test_uln_config();
    let config_params = array![SetDefaultUlnConfigParam { eid: DST_EID, config: uln_config }];

    cheat_caller_address_once(contract_address, NON_OWNER);
    admin.set_default_uln_receive_configs(config_params);
}

#[test]
fn test_set_and_get_default_uln_receive_config_multiple_sources() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    // Set configs for different source endpoints
    let config_src2 = UlnConfig {
        confirmations: 8,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let config_src3 = UlnConfig {
        confirmations: 18,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    // Use the batch API to set multiple configs at once
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_src2.clone() },
        SetDefaultUlnConfigParam { eid: DST_EID_2, config: config_src3.clone() },
    ];

    let mut spy = spy_events();

    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_receive_configs(config_params);

    // Verify different configs for different source endpoints
    let retrieved_config_src2 = admin.get_default_uln_receive_config(DST_EID);
    let retrieved_config_src3 = admin.get_default_uln_receive_config(DST_EID_2);

    assert(
        retrieved_config_src2.confirmations == config_src2.confirmations,
        'SRC2 confirmations incorrect',
    );
    assert(
        retrieved_config_src2.required_dvns.len() == config_src2.required_dvns.len(),
        'SRC2 DVNs count incorrect',
    );
    assert(
        retrieved_config_src3.confirmations == config_src3.confirmations,
        'SRC3 confirmations incorrect',
    );
    assert(
        retrieved_config_src3.required_dvns.len() == config_src3.required_dvns.len(),
        'SRC3 DVNs count incorrect',
    );

    // Verify events were emitted for both configs
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DefaultUlnReceiveConfigsSet(
                        DefaultUlnReceiveConfigsSet {
                            params: array![
                                SetDefaultUlnConfigParam { eid: DST_EID, config: config_src2 },
                                SetDefaultUlnConfigParam { eid: DST_EID_2, config: config_src3 },
                            ],
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_set_and_get_raw_oapp_uln_receive_config_multiple_receivers() {
    let (admin, contract_address) = deploy_ultra_light_node_302();
    let default_config = create_test_uln_config();
    let config_params = array![SetDefaultUlnConfigParam { eid: DST_EID, config: default_config }];

    // First set default receive config as owner
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_receive_configs(config_params);

    // Set configs for different receivers (no ownership required)
    let config_receiver1 = UlnConfig {
        confirmations: 9,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let config_receiver2 = UlnConfig {
        confirmations: 13,
        has_confirmations: true,
        required_dvns: array![DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let mut spy = spy_events();

    // Set config for SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, SENDER, DST_EID, config_receiver1.clone(),
    );

    // Set config for SENDER_2
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, SENDER_2, DST_EID, config_receiver2.clone(),
    );

    // Verify different configs for different receivers
    let retrieved_config_receiver1 = admin.get_raw_oapp_uln_receive_config(SENDER, DST_EID);
    let retrieved_config_receiver2 = admin.get_raw_oapp_uln_receive_config(SENDER_2, DST_EID);

    assert(
        retrieved_config_receiver1.confirmations == config_receiver1.confirmations,
        'Recv conf not custom',
    );
    assert(
        retrieved_config_receiver2.confirmations == config_receiver2.confirmations,
        'Recv conf not custom',
    );

    // Verify events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnReceiveConfigSet(
                        OAppUlnReceiveConfigSet {
                            oapp: SENDER, src_eid: DST_EID, config: config_receiver1,
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnReceiveConfigSet(
                        OAppUlnReceiveConfigSet {
                            oapp: SENDER_2, src_eid: DST_EID, config: config_receiver2,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_oapp_receive_config_overrides_default() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    let default_config = UlnConfig {
        confirmations: 12,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: default_config.clone() },
    ];

    // Set default receive config
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_receive_configs(config_params);

    // Set OApp-specific receive config that should override default
    let oapp_config = UlnConfig {
        confirmations: 22,
        has_confirmations: true,
        required_dvns: array![DVN_2],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let mut spy = spy_events();

    // Set config for SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, SENDER, DST_EID, oapp_config.clone(),
    );

    // Verify that default and OApp effective configs are different
    let oapp_effective_config = admin.get_oapp_uln_receive_config(SENDER, DST_EID);

    assert(
        oapp_effective_config.confirmations == oapp_config.confirmations,
        'OApp receive conf incorrect',
    );
    assert(
        oapp_effective_config.required_dvns.len() == oapp_config.required_dvns.len(),
        'OApp receive DVNs count inc',
    );
    assert(
        *oapp_effective_config.required_dvns.at(0) == *oapp_config.required_dvns.at(0),
        'OApp receive DVN incorrect',
    );

    // Check that a different receiver would get the default config (not overridden)
    let other_receiver_effective_config = admin.get_oapp_uln_receive_config(SENDER_2, DST_EID);
    assert(
        other_receiver_effective_config.confirmations == default_config.confirmations,
        'Other recv should get default',
    );
    assert(
        *other_receiver_effective_config.required_dvns.at(0) == *default_config.required_dvns.at(0),
        'recv2 should get default',
    );

    // Verify OApp receive config event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnReceiveConfigSet(
                        OAppUlnReceiveConfigSet {
                            oapp: SENDER, src_eid: DST_EID, config: oapp_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_oapp_receive_config_partial_override() {
    let (admin, contract_address) = deploy_ultra_light_node_302();

    let default_config = UlnConfig {
        confirmations: 16,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_2],
        has_required_dvns: true,
        optional_dvns: array![DVN_3],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };
    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: default_config.clone() },
    ];

    // Set default receive config with all fields populated
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_receive_configs(config_params);

    // Set OApp-specific receive config that only overrides some fields
    let partial_oapp_config = UlnConfig {
        confirmations: 26, // Override confirmations
        has_confirmations: true,
        required_dvns: array![], // Don't override required DVNs (use default)
        has_required_dvns: false, // This means use default
        optional_dvns: array![DVN_1, DVN_2], // Override optional DVNs
        optional_dvn_threshold: 2, // Override optional threshold
        has_optional_dvns: true,
    };

    let mut spy = spy_events();

    // Set config for SENDER
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, SENDER, DST_EID, partial_oapp_config.clone(),
    );

    // Get the effective config (resolved)
    let effective_config = admin.get_oapp_uln_receive_config(SENDER, DST_EID);

    // Verify partial override behavior:
    // - confirmations should be overridden (26, not 16)
    // - required_dvns should use default (DVN_1, DVN_2 from default, not empty from oapp)
    // - optional_dvns should be overridden (DVN_1, DVN_2 from oapp, not DVN_3 from default)
    // - optional_dvn_threshold should be overridden (2, not 1)

    assert(
        effective_config.confirmations == partial_oapp_config.confirmations, 'Recv conf not custom',
    );
    assert(
        effective_config.required_dvns.len() == default_config.required_dvns.len(),
        'Recv req DVNs not default',
    );
    assert(
        *effective_config.required_dvns.at(0) == *default_config.required_dvns.at(0),
        'Recv req DVN.0 not default',
    );
    assert(
        *effective_config.required_dvns.at(1) == *default_config.required_dvns.at(1),
        'Recv req DVN.1 not default',
    );
    assert(
        effective_config.optional_dvns.len() == partial_oapp_config.optional_dvns.len(),
        'Recv opt DVNs not custom',
    );
    assert(
        *effective_config.optional_dvns.at(0) == *partial_oapp_config.optional_dvns.at(0),
        'Recv opt DVN.0 not custom',
    );
    assert(
        *effective_config.optional_dvns.at(1) == *partial_oapp_config.optional_dvns.at(1),
        'Recv opt DVN.1 not custom',
    );
    assert(
        effective_config.optional_dvn_threshold == partial_oapp_config.optional_dvn_threshold,
        'Recv opt thresh not custom',
    );

    // Verify OApp receive config event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::OAppUlnReceiveConfigSet(
                        OAppUlnReceiveConfigSet {
                            oapp: SENDER, src_eid: DST_EID, config: partial_oapp_config,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_empty_receive_configs_return_defaults() {
    let (admin, _) = deploy_ultra_light_node_302();

    // Getting receive configs that were never set should return empty/default values
    let empty_default_receive_config = admin.get_default_uln_receive_config(DST_EID);
    let empty_oapp_receive_config = admin.get_raw_oapp_uln_receive_config(SENDER, DST_EID);

    // These should be empty/default values
    assert(empty_default_receive_config.confirmations == 0, 'Default receive should be empty');
    assert(empty_default_receive_config.required_dvns.len() == 0, 'Default receive dvns != empty');
    assert(empty_oapp_receive_config.confirmations == 0, 'OApp receive should be empty');
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_receive_config_fails_with_duplicate_required_dvns() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with duplicate required DVNs
    let config_with_duplicate_required = UlnConfig {
        confirmations: 11,
        has_confirmations: true,
        required_dvns: array![DVN_1, DVN_1], // Duplicate DVN_1
        has_required_dvns: true,
        optional_dvns: array![DVN_2],
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    };

    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_duplicate_required },
    ];

    // Try to set default receive config with duplicate required DVNs - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_receive_configs(config_params);
    assert_panic_with_error(result, err_unsorted_dvns());
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_default_uln_receive_config_fails_with_zero_confirmations() {
    let (admin_safe, contract_address) = deploy_ultra_light_node_302_safe();

    // Create config with zero confirmations
    let config_with_zero_confirmations = UlnConfig {
        confirmations: 0, // Invalid: confirmations must be > 0
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    };

    let config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: config_with_zero_confirmations },
    ];

    // Try to set default receive config with zero confirmations - should fail
    cheat_caller_address_once(contract_address, OWNER);
    let result = admin_safe.set_default_uln_receive_configs(config_params);
    assert_panic_with_error(result, err_invalid_confirmations());
}
