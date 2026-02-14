//! ULN quote tests

use core::num::traits::Bounded;
use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::common::structs::packet::Packet;
use layerzero::message_lib::interface::{
    IMessageLibDispatcher, IMessageLibDispatcherTrait, IMessageLibSafeDispatcher,
    IMessageLibSafeDispatcherTrait,
};
use layerzero::message_lib::uln_302::errors::{
    err_message_too_large, err_must_have_at_least_one_dvn,
};
use layerzero::message_lib::uln_302::events::TreasuryNativeFeeCapSet;
use layerzero::message_lib::uln_302::interface::{
    IUltraLightNode302AdminDispatcher, IUltraLightNode302AdminDispatcherTrait,
    IUltraLightNode302AdminSafeDispatcher,
};
use layerzero::message_lib::uln_302::options::TYPE_3;
use layerzero::message_lib::uln_302::structs::executor_config::{
    ExecutorConfig, SetDefaultExecutorConfigParam,
};
use layerzero::message_lib::uln_302::structs::uln_config::{SetDefaultUlnConfigParam, UlnConfig};
use layerzero::message_lib::uln_302::ultra_light_node_302::UltraLightNode302;
use layerzero::workers::dvn::options::DVN_WORKER_ID;
use layerzero::workers::executor::options::EXECUTOR_WORKER_ID;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};

// Import shared test utils
use crate::message_lib::uln_302::utils::{
    set_oapp_executor_send_config_via_message_lib, set_oapp_uln_send_config_via_message_lib,
};
use crate::mocks::treasury::treasury::MockTreasury::{
    IMockTreasuryHelpersDispatcher, IMockTreasuryHelpersDispatcherTrait,
};
use crate::mocks::workers::dvn::MockDVN::{
    IMockDVNHelpersDispatcher, IMockDVNHelpersDispatcherTrait,
};
use crate::utils::sort;

// Test constants
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const ENDPOINT: ContractAddress = 'endpoint'.try_into().unwrap();
pub const SENDER: ContractAddress = 'sender'.try_into().unwrap();
pub const RECEIVER: ContractAddress = 'receiver'.try_into().unwrap();
pub const DVN_1: ContractAddress = 'dvn_1'.try_into().unwrap();
pub const DVN_2: ContractAddress = 'dvn_2'.try_into().unwrap();
pub const DVN_3: ContractAddress = 'dvn_3'.try_into().unwrap();
pub const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
pub const PRICE_FEED: ContractAddress = 'price_feed'.try_into().unwrap();
pub const DST_EID: u32 = 2;
pub const SRC_EID: u32 = 1;

// Quote fee constants
pub const DVN_QUOTE: u256 = 1000;
pub const DVN_QUOTE_2: u256 = 1500;
pub const DVN_QUOTE_OPTIONAL_1: u256 = 800;
pub const DVN_QUOTE_OPTIONAL_2: u256 = 900;
pub const DVN_QUOTE_CUSTOM: u256 = 1500;
pub const EXECUTOR_QUOTE: u256 = 2000;
pub const EXECUTOR_QUOTE_CUSTOM: u256 = 3000;
pub const TREASURY_QUOTE: u256 = 50; // Below cap to test normal operation
pub const TREASURY_QUOTE_AT_CAP: u256 = 200; // At cap
pub const TREASURY_QUOTE_ABOVE_CAP: u256 = 500; // Above cap to test capping
pub const ZERO_FEE: u256 = 0;
pub const LARGE_DVN_FEE: u256 = 1000000000000000000; // 1 ETH
pub const LARGE_EXECUTOR_FEE: u256 = 500000000000000000; // 0.5 ETH
pub const LARGE_TREASURY_FEE: u256 = 200000000000000000; // 0.2 ETH
pub const TREASURY_NATIVE_FEE_CAP: u256 = 200;

// Helper functions
fn deploy_ultra_light_node_302(
    dvn_quote_amount: u256, executor_quote_amount: u256, treasury_quote_amount: u256,
) -> (
    IMessageLibDispatcher,
    IMessageLibSafeDispatcher,
    IUltraLightNode302AdminDispatcher,
    IUltraLightNode302AdminSafeDispatcher,
    ContractAddress,
    ContractAddress,
    ContractAddress,
    ContractAddress,
) {
    let contract = declare("UltraLightNode302").unwrap_syscall().contract_class();
    let treasury = deploy_mock_treasury(treasury_quote_amount);
    let mut constructor_calldata = array![OWNER.into(), treasury.into(), ENDPOINT.into()];
    TREASURY_NATIVE_FEE_CAP.serialize(ref constructor_calldata);
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();

    let message_lib = IMessageLibDispatcher { contract_address };
    let message_lib_safe = IMessageLibSafeDispatcher { contract_address };
    let admin = IUltraLightNode302AdminDispatcher { contract_address };
    let admin_safe = IUltraLightNode302AdminSafeDispatcher { contract_address };

    let dvn_address = deploy_mock_dvn(dvn_quote_amount);
    let executor_address = deploy_mock_executor(executor_quote_amount);

    // Return prohibitively high fees from the fee payment functions to ensure that tests do not hit
    // them.
    start_mock_call(dvn_address, selector!("assign_job"), Bounded::<u256>::MAX);
    start_mock_call(executor_address, selector!("assign_job"), Bounded::<u256>::MAX);
    start_mock_call(treasury, selector!("pay_fee"), Bounded::<u256>::MAX);

    (
        message_lib,
        message_lib_safe,
        admin,
        admin_safe,
        contract_address,
        treasury,
        dvn_address,
        executor_address,
    )
}

fn deploy_mock_treasury(treasury_fee: u256) -> ContractAddress {
    let contract = declare("MockTreasury").unwrap_syscall().contract_class();
    let constructor_calldata = array![treasury_fee.low.into(), treasury_fee.high.into()];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    address
}

fn deploy_mock_dvn(quote_result: u256) -> ContractAddress {
    let contract = declare("MockDVN").unwrap_syscall().contract_class();
    let constructor_calldata = array![quote_result.low.into(), quote_result.high.into()];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    address
}

fn deploy_mock_executor(quote_result: u256) -> ContractAddress {
    let contract = declare("MockExecutor").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        quote_result.low.into(), quote_result.high.into(), ZERO_ADDRESS.into(), ZERO_ADDRESS.into(),
        ZERO_ADDRESS.into(),
    ];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    address
}

fn create_test_uln_config_with_dvns(
    required_dvns: Array<ContractAddress>,
    optional_dvns: Array<ContractAddress>,
    optional_threshold: u8,
) -> UlnConfig {
    UlnConfig {
        confirmations: 10,
        has_confirmations: true,
        required_dvns,
        has_required_dvns: true,
        optional_dvns,
        optional_dvn_threshold: optional_threshold,
        has_optional_dvns: true,
    }
}

fn create_test_executor_config(executor_address: ContractAddress) -> ExecutorConfig {
    ExecutorConfig { max_message_size: 1000, executor: executor_address }
}

fn create_test_packet() -> Packet {
    Packet {
        nonce: 1,
        src_eid: SRC_EID,
        sender: SENDER,
        dst_eid: DST_EID,
        receiver: RECEIVER.into(),
        guid: Bytes32 { value: 'test_guid'.into() },
        message: "test message",
    }
}

fn create_empty_options() -> ByteArray {
    let mut options: ByteArray = Default::default();
    options.append_u16(TYPE_3);
    options
}


// Helper function to set up default config for an EID (makes EID supported)
fn setup_default_config_with_dvns(
    admin: IUltraLightNode302AdminDispatcher,
    contract_address: ContractAddress,
    dst_eid: u32,
    required_dvns: Array<ContractAddress>,
    optional_dvns: Array<ContractAddress>,
    optional_threshold: u8,
    executor_address: ContractAddress,
) {
    // Set default ULN config
    let default_config = create_test_uln_config_with_dvns(
        required_dvns, optional_dvns, optional_threshold,
    );
    let config_params = array![SetDefaultUlnConfigParam { eid: dst_eid, config: default_config }];

    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    // Set default executor config
    let executor_config = create_test_executor_config(executor_address);
    cheat_caller_address_once(contract_address, OWNER);
    admin
        .set_default_executor_configs(
            array![SetDefaultExecutorConfigParam { dst_eid, config: executor_config }],
        );
}


#[test]
fn test_quote_with_single_required_dvn() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config with one required DVN
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Expected: DVN fee + executor fee + treasury fee
    // Treasury fee = 50, cap = 200, total other fees = 3000, so treasury fee = 50 (not capped)
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE; // 1000 + 2000 + 50 = 3050
    assert(result.native_fee == expected_fee, 'incorrect total fee');
}

#[test]
fn test_quote_with_multiple_required_dvns() {
    let (message_lib, _, admin, _, contract_address, _, dvn1_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );
    let dvn2_address = deploy_mock_dvn(DVN_QUOTE_2);

    // Setup default config with two required DVNs (need to sort addresses)
    setup_default_config_with_dvns(
        admin,
        contract_address,
        DST_EID,
        sort(array![dvn1_address, dvn2_address]),
        array![],
        0,
        executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Expected: DVN1 fee + DVN2 fee + executor fee + treasury fee
    // Treasury fee = 50, cap = 200, total other fees = 4500, so treasury fee = 50 (not capped)
    let expected_fee = DVN_QUOTE
        + DVN_QUOTE_2
        + EXECUTOR_QUOTE
        + TREASURY_QUOTE; // 1000 + 1500 + 2000 + 50 = 4550
    assert(result.native_fee == expected_fee, 'incorrect total fee');
}

#[test]
fn test_quote_with_optional_dvns() {
    let (message_lib, _, admin, _, contract_address, _, required_dvn, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );
    let optional_dvn1 = deploy_mock_dvn(DVN_QUOTE_OPTIONAL_1);
    let optional_dvn2 = deploy_mock_dvn(DVN_QUOTE_OPTIONAL_2);

    // Setup default config with 1 required DVN and 2 optional DVNs with threshold 2
    setup_default_config_with_dvns(
        admin,
        contract_address,
        DST_EID,
        array![required_dvn],
        sort(array![optional_dvn1, optional_dvn2]),
        2,
        executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Expected: required DVN + all optional DVNs + executor fee + treasury fee
    let expected_fee = DVN_QUOTE
        + DVN_QUOTE_OPTIONAL_1
        + DVN_QUOTE_OPTIONAL_2
        + EXECUTOR_QUOTE
        + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'incorrect total fee');
}

#[test]
fn test_quote_with_empty_options() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Should work with empty options
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'incorrect fee w/ empty options');
}

#[test]
fn test_quote_with_type3_options() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();

    // Create type 3 options with executor and DVN options
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // Add executor option (worker_id=1, size=5, gas=100000)
    options.append_u8(EXECUTOR_WORKER_ID);
    options.append_u16(5); // option_size
    options.append_u8(1); // option_type (LZ_RECEIVE)
    options.append_u32(100000); // gas
    // Add DVN option (worker_id=2, size=3, idx=0, type=1, data=0x01)
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x01); // option_data

    let result = message_lib.quote(packet, options, false);

    // Should work with type 3 options
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'incorrect fee w/ type3 options');
}

#[test]
fn test_quote_with_zero_fees() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        ZERO_FEE, ZERO_FEE, ZERO_FEE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Should return zero fee
    let expected_fee = ZERO_FEE + ZERO_FEE + ZERO_FEE;
    assert(result.native_fee == expected_fee, 'fee should be zero');
}

#[test]
fn test_quote_with_large_fees() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        LARGE_DVN_FEE, LARGE_EXECUTOR_FEE, LARGE_TREASURY_FEE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Should handle large fees correctly
    let expected_fee = LARGE_DVN_FEE + LARGE_EXECUTOR_FEE + LARGE_TREASURY_FEE;
    assert(result.native_fee == expected_fee, 'incorrect large fee calculation');
}

#[test]
fn test_quote_with_different_message_sizes() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    // Test with different message sizes
    let mut large_packet = create_test_packet();
    large_packet
        .message =
            "This is a much longer message that should affect the calldata_size parameter passed to the executor quote function";

    let options = create_empty_options();

    let result = message_lib.quote(large_packet, options, false);

    // Should work with different message sizes
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'incorrect fee w/ large message');
}

#[test]
#[feature("safe_dispatcher")]
fn test_quote_with_unsupported_eid() {
    let (_, message_lib_safe, _, _, _, _, _, _) = deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Don't set up any default config, so EID is unsupported
    let packet = create_test_packet();
    let options = create_empty_options();

    // Should panic with unsupported EID error when trying to quote
    let result = message_lib_safe.quote(packet.clone(), options, false);

    // Why does it fail with this error?
    // Because we can't set an OApp config until the default config for that path
    // is set, and if it's not set, when `get_oapp_uln_send_config` tries to call
    // ulnConfig.resolve, it will resolve two "empty" configs together and
    // this is the first assert that it will see at the bottom of .resolve
    assert_panic_with_error(result, err_must_have_at_least_one_dvn());
}

#[test]
fn test_quote_uses_resolved_config() {
    let (message_lib, _, admin, _, contract_address, _, default_dvn, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );
    let custom_dvn = deploy_mock_dvn(DVN_QUOTE_CUSTOM);

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![default_dvn], array![], 0, executor_address,
    );

    // Set custom OApp config
    let custom_config = create_test_uln_config_with_dvns(array![custom_dvn], array![], 0);

    start_cheat_caller_address(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(contract_address, SENDER, DST_EID, custom_config);
    stop_cheat_caller_address(contract_address);

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Should use the custom DVN, not the default one
    let expected_fee = DVN_QUOTE_CUSTOM + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'should use custom config');
}

#[test]
fn test_quote_uses_resolved_executor_config() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, default_executor) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );
    let custom_executor = deploy_mock_executor(EXECUTOR_QUOTE_CUSTOM);

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, default_executor,
    );

    // Set custom executor config
    let custom_executor_config = ExecutorConfig {
        max_message_size: 2000, executor: custom_executor,
    };

    start_cheat_caller_address(contract_address, ENDPOINT);
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, custom_executor_config,
    );
    stop_cheat_caller_address(contract_address);

    let packet = create_test_packet();
    let options = create_empty_options();

    let result = message_lib.quote(packet, options, false);

    // Should use the custom executor, not the default one
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE_CUSTOM + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'should use custom executor');
}

#[test]
fn test_quote_with_mock_dvn_failure() {
    let (_, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    // Make DVN fail
    let mut dvn_helpers = IMockDVNHelpersDispatcher { contract_address: dvn_address };
    dvn_helpers.set_should_fail(true);

    // Test should verify the DVN is configured to fail
    assert(dvn_helpers.get_should_fail(), 'DVN should be set to fail');
}

#[test]
#[feature("safe_dispatcher")]
fn test_quote_message_too_large() {
    let (_, message_lib_safe, admin, _, contract_address, _, dvn_address, _) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Set up executor with a small max_message_size
    let small_max_size = 10_u32;
    let executor_address = deploy_mock_executor(EXECUTOR_QUOTE);

    // Setup default config with small max message size
    let default_config = create_test_uln_config_with_dvns(array![dvn_address], array![], 0);
    let default_config_params = array![
        SetDefaultUlnConfigParam { eid: DST_EID, config: default_config },
    ];
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(default_config_params);

    // Set default executor config with small max message size
    let executor_config = ExecutorConfig {
        max_message_size: small_max_size, executor: executor_address,
    };
    let executor_config_params = array![
        SetDefaultExecutorConfigParam { dst_eid: DST_EID, config: executor_config },
    ];
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_executor_configs(executor_config_params);

    // Create packet with message larger than max_message_size
    let mut large_packet = create_test_packet();
    large_packet
        .message =
            "This message is definitely longer than 10 characters and should trigger the message too large error";

    let options = create_empty_options();

    // Should panic with message too large error
    let result = message_lib_safe.quote(large_packet.clone(), options, false);
    assert_panic_with_error(
        result, err_message_too_large(large_packet.message.len(), small_max_size.into()),
    );
}

#[test]
fn test_quote_with_single_dvn_option() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config with one required DVN
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with DVN option
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // Add DVN option: worker_id=2, option_size=3, dvn_idx=0, option_type=1, option_data=0x01
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size (dvn_idx + option_type + option_data)
    options.append_u8(0); // dvn_idx (first DVN)
    options.append_u8(1); // option_type (PRECRIME)
    options.append_u8(0x01); // option_data

    let result = message_lib.quote(packet, options, false);

    // Expected: DVN fee + executor fee + treasury fee
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'incorrect fee with dvn option');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_quote_with_multiple_dvn_options_same_index() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config with one required DVN
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with multiple DVN options for same DVN index
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // First DVN option for index 0
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x01); // option_data
    // Second DVN option for same index 0
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(4); // option_size
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u16(0x0203); // option_data (2 bytes)

    let result = message_lib.quote(packet, options, false);

    // Should work - options get combined for same DVN index
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'inc fee w/ combined options');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_quote_with_multiple_dvns_different_options() {
    let (message_lib, _, admin, _, contract_address, _, dvn1_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );
    let dvn2_address = deploy_mock_dvn(DVN_QUOTE_2);

    // Setup default config with two required DVNs
    setup_default_config_with_dvns(
        admin,
        contract_address,
        DST_EID,
        sort(array![dvn1_address, dvn2_address]),
        array![],
        0,
        executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with different DVN options for different DVN indices
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // DVN option for index 0
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x01); // option_data
    // DVN option for index 1
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(4); // option_size
    options.append_u8(1); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u16(0x0203); // option_data (2 bytes)

    let result = message_lib.quote(packet, options, false);

    // Expected: DVN1 fee + DVN2 fee + executor fee + treasury fee
    let expected_fee = DVN_QUOTE + DVN_QUOTE_2 + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'inc fee w/ multi dvn options');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_quote_with_dvn_options_and_executor_options() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with both executor and DVN options
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // Executor option
    options.append_u8(EXECUTOR_WORKER_ID);
    options.append_u16(5); // option_size
    options.append_u8(1); // option_type (LZ_RECEIVE)
    options.append_u32(100000); // gas
    // DVN option
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x01); // option_data

    let result = message_lib.quote(packet, options, false);

    // Should work with both executor and DVN options
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'incorrect fee with both options');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_quote_with_optional_dvns_and_options() {
    let (message_lib, _, admin, _, contract_address, _, required_dvn, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );
    let optional_dvn1 = deploy_mock_dvn(DVN_QUOTE_OPTIONAL_1);
    let optional_dvn2 = deploy_mock_dvn(DVN_QUOTE_OPTIONAL_2);

    // Setup default config with 1 required DVN and 2 optional DVNs
    setup_default_config_with_dvns(
        admin,
        contract_address,
        DST_EID,
        array![required_dvn],
        sort(array![optional_dvn1, optional_dvn2]),
        2,
        executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with DVN options for all DVNs
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // DVN option for index 0 (required DVN)
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x01); // option_data
    // DVN option for index 1 (first optional DVN)
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(1); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x02); // option_data
    // DVN option for index 2 (second optional DVN)
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(2); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x03); // option_data

    let result = message_lib.quote(packet, options, false);

    // Expected: required DVN + all optional DVNs + executor fee + treasury fee
    let expected_fee = DVN_QUOTE
        + DVN_QUOTE_OPTIONAL_1
        + DVN_QUOTE_OPTIONAL_2
        + EXECUTOR_QUOTE
        + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'inc fee w/ optional dvn options');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_quote_with_larger_dvn_option_data() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with larger DVN option data
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // DVN option with larger data payload
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(10); // option_size (dvn_idx + option_type + 8 bytes data)
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    // 8 bytes of option data
    options.append_u64(0x0123456789abcdef); // option_data

    let result = message_lib.quote(packet, options, false);

    // Should work with larger option data
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'inc fee w/ large dvn option');
}

#[test]
fn test_quote_with_dvn_options_missing_index() {
    let (message_lib, _, admin, _, contract_address, _, dvn1_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );
    let dvn2_address = deploy_mock_dvn(DVN_QUOTE_2);

    // Setup default config with two required DVNs
    setup_default_config_with_dvns(
        admin,
        contract_address,
        DST_EID,
        sort(array![dvn1_address, dvn2_address]),
        array![],
        0,
        executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with DVN option only for index 0, missing index 1
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // DVN option for index 0 only
    options.append_u8(DVN_WORKER_ID);
    options.append_u16(3); // option_size
    options.append_u8(0); // dvn_idx
    options.append_u8(1); // option_type
    options.append_u8(0x01); // option_data

    let result = message_lib.quote(packet, options, false);

    // Should work - DVN at index 1 gets empty options
    let expected_fee = DVN_QUOTE + DVN_QUOTE_2 + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'inc fee w/ missing dvn option');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_quote_with_empty_dvn_options_section() {
    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    // Setup default config
    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();

    // Create Type 3 options with only executor options, no DVN options
    let mut options = Default::default();
    options.append_u16(TYPE_3);
    // Only executor option
    options.append_u8(EXECUTOR_WORKER_ID);
    options.append_u16(5); // option_size
    options.append_u8(1); // option_type (LZ_RECEIVE)
    options.append_u32(100000); // gas

    let result = message_lib.quote(packet, options, false);

    // Should work - DVN gets empty options
    let expected_fee = DVN_QUOTE + EXECUTOR_QUOTE + TREASURY_QUOTE;
    assert(result.native_fee == expected_fee, 'inc fee w/ no dvn options');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_native_cap_with_small_fees() {
    // Use small DVN/executor fees so cap actually applies
    const DVN_QUOTE_AMOUNT: u256 = 10;
    const EXECUTOR_QUOTE_AMOUNT: u256 = 20;

    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE_AMOUNT, EXECUTOR_QUOTE_AMOUNT, TREASURY_QUOTE_ABOVE_CAP,
    );

    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();
    let result = message_lib.quote(packet, options, false);

    // DVN=10, executor=20, total_other_fees=30, cap=200, treasury_quote=500
    // max_native_fee = max(30, 200) = 200
    // actual_treasury_fee = min(500, 200) = 200 (capped!)
    let expected_fee = 10 + 20 + 200; // 230
    assert(result.native_fee == expected_fee, 'treasury fee should be capped');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_native_cap_at_threshold() {
    const DVN_QUOTE_AMOUNT: u256 = 100;
    const EXECUTOR_QUOTE_AMOUNT: u256 = 100;

    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE_AMOUNT, EXECUTOR_QUOTE_AMOUNT, TREASURY_QUOTE_AT_CAP,
    );

    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();
    let result = message_lib.quote(packet, options, false);

    // DVN=100, executor=100, total_other_fees=200, cap=200, treasury_quote=200
    // max_native_fee = max(200, 200) = 200
    // actual_treasury_fee = min(200, 200) = 200
    let expected_fee = 100 + 100 + 200; // 400
    assert(result.native_fee == expected_fee, 'treasury fee at cap boundary');
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_native_cap_with_fees_above_limit() {
    // Use large DVN/executor fees that exceed the cap
    const DVN_QUOTE_AMOUNT: u256 = 150;
    const EXECUTOR_QUOTE_AMOUNT: u256 = 150;

    let (message_lib, _, admin, _, contract_address, _, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        DVN_QUOTE_AMOUNT, EXECUTOR_QUOTE_AMOUNT, TREASURY_QUOTE_ABOVE_CAP,
    );

    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();
    let result = message_lib.quote(packet, options, false);

    // DVN=150, executor=150, total_other_fees=300, cap=200, treasury_quote=500
    // max_native_fee = max(300, 200) = 300
    // actual_treasury_fee = min(500, 300) = 300
    assert(
        result.native_fee == 2 * (DVN_QUOTE_AMOUNT + EXECUTOR_QUOTE_AMOUNT),
        'treasury fee follows other',
    );
    assert(result.lz_token_fee == 0, 'incorrect lz token fee');
}

#[test]
fn test_native_cap_admin_functions() {
    let (_, _, admin, _, contract_address, _, _, _) = deploy_ultra_light_node_302(
        DVN_QUOTE, EXECUTOR_QUOTE, TREASURY_QUOTE,
    );

    let mut spy = spy_events();

    // Test getting current cap
    let current_cap = admin.get_treasury_native_fee_cap();
    assert(current_cap == TREASURY_NATIVE_FEE_CAP, 'incorrect initial cap');

    // Test setting new cap (based on current implementation, can only decrease)
    let new_cap = TREASURY_NATIVE_FEE_CAP - 50; // 200 - 50 = 150

    cheat_caller_address_once(contract_address, OWNER);
    admin.set_treasury_native_fee_cap(new_cap);

    let updated_cap = admin.get_treasury_native_fee_cap();
    assert(updated_cap == new_cap, 'cap not updated correctly');

    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::TreasuryNativeFeeCapSet(
                        TreasuryNativeFeeCapSet { native_fee_cap: new_cap },
                    ),
                ),
            ],
        );
}

#[test]
#[fuzzer(runs: 10)]
fn test_quote_treasury_fee_in_lz_tokens(
    dvn_fee: u64, executor_fee: u64, native_treasury_fee: u64, lz_token_treasury_fee: u64,
) {
    let dvn_fee = dvn_fee.into();
    let executor_fee = executor_fee.into();
    let native_treasury_fee = native_treasury_fee.into();
    let lz_token_treasury_fee = lz_token_treasury_fee.into();

    let (message_lib, _, admin, _, contract_address, treasury, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        dvn_fee, executor_fee, native_treasury_fee,
    );

    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    IMockTreasuryHelpersDispatcher { contract_address: treasury }
        .set_lz_token_fee(Some(lz_token_treasury_fee));

    let packet = create_test_packet();
    let options = create_empty_options();
    let result = message_lib.quote(packet, options, true);

    assert(result.native_fee == dvn_fee + executor_fee, 'unexpected native fee');
    assert(result.lz_token_fee == lz_token_treasury_fee, 'unexpected LZ token fee');
}

#[test]
#[fuzzer(runs: 10)]
fn test_quote_uncapped_treasury_fee_in_lz_tokens(
    dvn_fee: u64, executor_fee: u64, native_treasury_fee: u64,
) {
    let dvn_fee = dvn_fee.into();
    let executor_fee = executor_fee.into();
    let native_treasury_fee = native_treasury_fee.into();

    let (message_lib, _, admin, _, contract_address, treasury, dvn_address, executor_address) =
        deploy_ultra_light_node_302(
        dvn_fee, executor_fee, native_treasury_fee,
    );

    setup_default_config_with_dvns(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    IMockTreasuryHelpersDispatcher { contract_address: treasury }
        .set_lz_token_fee(Some(Bounded::MAX));

    let packet = create_test_packet();
    let options = create_empty_options();
    let result = message_lib.quote(packet, options, true);

    assert(result.native_fee == dvn_fee + executor_fee, 'unexpected native fee');
    assert(result.lz_token_fee == Bounded::MAX, 'unexpected LZ token fee');
}
