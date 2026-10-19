//! ULN send tests

use core::num::traits::Bounded;
use layerzero::common::constants::ZERO_ADDRESS;
use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::common::structs::messaging::{MessageLibSendResult, Payee};
use layerzero::common::structs::packet::{Packet, PacketHeader};
use layerzero::message_lib::interface::{
    IMessageLibDispatcher, IMessageLibDispatcherTrait, IMessageLibSafeDispatcher,
    IMessageLibSafeDispatcherTrait,
};
use layerzero::message_lib::uln_302::errors::{
    err_caller_not_endpoint, err_message_too_large, err_must_have_at_least_one_dvn,
};
use layerzero::message_lib::uln_302::events::{DvnFeesPaid, ExecutorFeePaid, TreasuryFeePaid};
use layerzero::message_lib::uln_302::interface::{
    IUltraLightNode302AdminDispatcher, IUltraLightNode302AdminDispatcherTrait,
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
    start_mock_call,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::common::utils::total_native_fee_from_receipt;

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
use crate::mocks::workers::executor::executor::MockExecutor::{
    IMockExecutorHelpersDispatcher, IMockExecutorHelpersDispatcherTrait,
};
use crate::utils::sort;

// Test constants
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const ENDPOINT: ContractAddress = 'endpoint'.try_into().unwrap();
pub const NON_ENDPOINT: ContractAddress = 'non_endpoint'.try_into().unwrap();
pub const SENDER: ContractAddress = 'sender'.try_into().unwrap();
pub const RECEIVER: ContractAddress = 'receiver'.try_into().unwrap();
pub const DVN_1: ContractAddress = 'dvn_1'.try_into().unwrap();
pub const DVN_2: ContractAddress = 'dvn_2'.try_into().unwrap();
pub const DVN_3: ContractAddress = 'dvn_3'.try_into().unwrap();
pub const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
pub const DST_EID: u32 = 2;
pub const SRC_EID: u32 = 1;
pub const MAX_MESSAGE_SIZE: u32 = 1000;
pub const CONFIRMATIONS: u64 = 20;
pub const TREASURY_NATIVE_FEE_CAP: u256 = 200;

// Fee constants
pub const DVN_FEE: u256 = 1000;
pub const DVN_FEE_2: u256 = 1500;
pub const DVN_FEE_OPTIONAL_1: u256 = 800;
pub const DVN_FEE_OPTIONAL_2: u256 = 900;
pub const EXECUTOR_FEE: u256 = 2000;
pub const TREASURY_FEE: u256 = 50; // Below cap to test normal operation
pub const TREASURY_FEE_AT_CAP: u256 = 200; // At cap
pub const TREASURY_FEE_ABOVE_CAP: u256 = 500; // Above cap to test capping
pub const ZERO_FEE: u256 = 0;

// Helper functions
fn deploy_ultra_light_node_302(
    treasury_fee: u256,
) -> (
    IMessageLibDispatcher,
    IMessageLibSafeDispatcher,
    IUltraLightNode302AdminDispatcher,
    ContractAddress,
    ContractAddress,
) {
    let contract = declare("UltraLightNode302").unwrap_syscall().contract_class();
    let treasury = deploy_mock_treasury(treasury_fee);
    let mut constructor_calldata = array![OWNER.into(), treasury.into(), ENDPOINT.into()];
    TREASURY_NATIVE_FEE_CAP.serialize(ref constructor_calldata);
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();

    let message_lib = IMessageLibDispatcher { contract_address };
    let message_lib_safe = IMessageLibSafeDispatcher { contract_address };
    let admin = IUltraLightNode302AdminDispatcher { contract_address };

    (message_lib, message_lib_safe, admin, contract_address, treasury)
}

fn deploy_mock_treasury(treasury_fee: u256) -> ContractAddress {
    let contract = declare("MockTreasury").unwrap_syscall().contract_class();
    let constructor_calldata = array![treasury_fee.low.into(), treasury_fee.high.into()];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();

    // Return a prohibitively high fee from the quote function to ensure that tests do not
    // hit them.
    start_mock_call(address, selector!("get_fee"), Bounded::<u256>::MAX);

    address
}

fn deploy_mock_dvn(fee: u256) -> ContractAddress {
    let contract = declare("MockDVN").unwrap_syscall().contract_class();
    let constructor_calldata = array![fee.low.into(), fee.high.into()];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();

    // Return a prohibitively high fee from the quote function to ensure that tests do not
    // hit them.
    start_mock_call(address, selector!("quote"), Bounded::<u256>::MAX);

    address
}

fn deploy_mock_executor(fee: u256) -> ContractAddress {
    let contract = declare("MockExecutor").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        fee.low.into(), fee.high.into(), ZERO_ADDRESS.into(), ZERO_ADDRESS.into(),
        ZERO_ADDRESS.into(),
    ];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();

    // Return a prohibitively high fee from the quote function to ensure that tests do not
    // hit them.
    start_mock_call(address, selector!("quote"), Bounded::<u256>::MAX);

    address
}

fn create_test_uln_config(
    required_dvns: Array<ContractAddress>,
    optional_dvns: Array<ContractAddress>,
    optional_threshold: u8,
) -> UlnConfig {
    UlnConfig {
        confirmations: CONFIRMATIONS,
        has_confirmations: true,
        required_dvns,
        has_required_dvns: true,
        optional_dvns,
        optional_dvn_threshold: optional_threshold,
        has_optional_dvns: true,
    }
}

fn create_test_executor_config(executor_address: ContractAddress) -> ExecutorConfig {
    ExecutorConfig { max_message_size: MAX_MESSAGE_SIZE, executor: executor_address }
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

fn create_packet_header_from_packet(packet: @Packet) -> PacketHeader {
    PacketHeader {
        nonce: *packet.nonce,
        src_eid: *packet.src_eid,
        sender: *packet.sender,
        dst_eid: *packet.dst_eid,
        receiver: *packet.receiver,
    }
}

fn setup_default_config_with_mocks(
    admin: IUltraLightNode302AdminDispatcher,
    contract_address: ContractAddress,
    dst_eid: u32,
    required_dvns: Array<ContractAddress>,
    optional_dvns: Array<ContractAddress>,
    optional_threshold: u8,
    executor_address: ContractAddress,
) {
    // Set default ULN config
    let default_config = create_test_uln_config(required_dvns, optional_dvns, optional_threshold);
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

// Test cases for send function
#[test]
fn test_send_with_single_required_dvn() {
    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        TREASURY_FEE,
    );
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let mut spy = spy_events();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, encoded_packet,
    } = message_lib.send(packet.clone(), options, false);

    // Verify receipt
    assert(message_receipt.guid == packet.guid, 'incorrect guid');
    assert(message_receipt.nonce == packet.nonce, 'incorrect nonce');
    assert(
        total_native_fee_from_receipt(@message_receipt) == DVN_FEE + EXECUTOR_FEE + TREASURY_FEE,
        'incorrect total fee',
    );
    assert(message_receipt.payees.len() == 3, 'incorrect payees count');

    // Verify payees
    let dvn_payee = message_receipt.payees.at(0);
    assert(*dvn_payee.receiver == dvn_address, 'incorrect dvn payee receiver');
    assert(*dvn_payee.native_amount == DVN_FEE, 'incorrect dvn payee amount');

    let executor_payee = message_receipt.payees.at(1);
    assert(*executor_payee.receiver == executor_address, 'inc executor payee receiver');
    assert(*executor_payee.native_amount == EXECUTOR_FEE, 'incorrect executor payee amount');

    let treasury_payee = message_receipt.payees.at(2);
    assert(*treasury_payee.receiver == treasury, 'inc treasury payee receiver');
    assert(*treasury_payee.native_amount == TREASURY_FEE, 'incorrect treasury payee amount');

    // Verify encoded packet is not empty
    assert(encoded_packet.len() > 0, 'encoded packet is empty');

    // Verify events were emitted
    let packet_header = create_packet_header_from_packet(@packet);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DvnFeesPaid(
                        DvnFeesPaid {
                            oapp: SENDER,
                            payees: array![
                                Payee {
                                    receiver: dvn_address,
                                    native_amount: DVN_FEE,
                                    lz_token_amount: 0,
                                },
                            ],
                            packet_header: packet_header.clone(),
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::ExecutorFeePaid(
                        ExecutorFeePaid {
                            oapp: SENDER,
                            payee: Payee {
                                receiver: executor_address,
                                native_amount: EXECUTOR_FEE,
                                lz_token_amount: 0,
                            },
                            packet_header: packet_header.clone(),
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::TreasuryFeePaid(
                        TreasuryFeePaid {
                            oapp: SENDER,
                            payee: Payee {
                                receiver: treasury, native_amount: TREASURY_FEE, lz_token_amount: 0,
                            },
                            packet_header: packet_header.clone(),
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_send_with_multiple_required_dvns() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let dvn1_address = deploy_mock_dvn(DVN_FEE);
    let dvn2_address = deploy_mock_dvn(DVN_FEE_2);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
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

    let mut spy = spy_events();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // Verify receipt
    let expected_total_fee = DVN_FEE + DVN_FEE_2 + EXECUTOR_FEE + TREASURY_FEE;
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'incorrect total fee',
    );
    assert(
        message_receipt.payees.len() == 4, 'incorrect payees count',
    ); // 2 DVNs + 1 executor + 1 treasury = 4 total

    // Verify DVN fees were paid (they should be in the DvnFeesPaid event)
    let expected_dvn_payees = if dvn1_address < dvn2_address {
        array![
            Payee { receiver: dvn1_address, native_amount: DVN_FEE, lz_token_amount: 0 },
            Payee { receiver: dvn2_address, native_amount: DVN_FEE_2, lz_token_amount: 0 },
        ]
    } else {
        array![
            Payee { receiver: dvn2_address, native_amount: DVN_FEE_2, lz_token_amount: 0 },
            Payee { receiver: dvn1_address, native_amount: DVN_FEE, lz_token_amount: 0 },
        ]
    };

    let packet_header = create_packet_header_from_packet(@packet);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DvnFeesPaid(
                        DvnFeesPaid {
                            oapp: SENDER, payees: expected_dvn_payees, packet_header: packet_header,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_send_with_optional_dvns() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let required_dvn = deploy_mock_dvn(DVN_FEE);
    let optional_dvn1 = deploy_mock_dvn(DVN_FEE_OPTIONAL_1);
    let optional_dvn2 = deploy_mock_dvn(DVN_FEE_OPTIONAL_2);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config with 1 required DVN and 2 optional DVNs with threshold 2
    setup_default_config_with_mocks(
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

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // Verify receipt - should include all DVNs (required + optional)
    let expected_total_fee = DVN_FEE
        + DVN_FEE_OPTIONAL_1
        + DVN_FEE_OPTIONAL_2
        + EXECUTOR_FEE
        + TREASURY_FEE;
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'incorrect total fee',
    );
}

#[test]
fn test_send_with_zero_fees() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(ZERO_FEE);
    let dvn_address = deploy_mock_dvn(ZERO_FEE);
    let executor_address = deploy_mock_executor(ZERO_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // Verify receipt
    assert(total_native_fee_from_receipt(@message_receipt) == ZERO_FEE, 'fee should be zero');
    assert(message_receipt.payees.len() == 3, 'incorrect payees count');

    // Verify all payees have zero amounts
    for i in 0..message_receipt.payees.len() {
        let payee = message_receipt.payees.at(i);
        assert(*payee.native_amount == ZERO_FEE, 'payee amount should be zero');
    }
}

#[test]
fn test_send_with_type3_options() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
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

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // Should work with type 3 options
    let expected_total_fee = DVN_FEE + EXECUTOR_FEE + TREASURY_FEE;
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'incorrect fee w/ type3 options',
    );
}

#[test]
fn test_send_with_custom_oapp_config() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let default_dvn = deploy_mock_dvn(DVN_FEE);
    let custom_dvn = deploy_mock_dvn(DVN_FEE_2);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![default_dvn], array![], 0, executor_address,
    );

    // Set custom OApp config
    let custom_config = create_test_uln_config(array![custom_dvn], array![], 0);
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_uln_send_config_via_message_lib(contract_address, SENDER, DST_EID, custom_config);

    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // Should use custom DVN fee, not default
    let expected_total_fee = DVN_FEE_2 + EXECUTOR_FEE + TREASURY_FEE;
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'should use custom config',
    );
}

#[test]
fn test_send_with_custom_executor_config() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let default_executor = deploy_mock_executor(EXECUTOR_FEE);
    let custom_executor = deploy_mock_executor(DVN_FEE_2); // Using different fee

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, default_executor,
    );

    // Set custom executor config
    let custom_executor_config = ExecutorConfig {
        max_message_size: 2000, executor: custom_executor,
    };
    cheat_caller_address_once(contract_address, ENDPOINT);
    set_oapp_executor_send_config_via_message_lib(
        contract_address, SENDER, DST_EID, custom_executor_config,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // Should use custom executor fee, not default
    let expected_total_fee = DVN_FEE + DVN_FEE_2 + TREASURY_FEE;
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'should use custom executor',
    );
}

#[test]
fn test_send_with_large_message() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);
    let default_config = create_test_uln_config(array![dvn_address], array![], 0);
    let config_params = array![SetDefaultUlnConfigParam { eid: DST_EID, config: default_config }];

    // Setup default config with large max message size
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    let executor_config = ExecutorConfig { max_message_size: 10000, executor: executor_address };
    cheat_caller_address_once(contract_address, OWNER);
    admin
        .set_default_executor_configs(
            array![SetDefaultExecutorConfigParam { dst_eid: DST_EID, config: executor_config }],
        );

    let mut large_packet = create_test_packet();
    large_packet
        .message =
            "This is a much longer message that should still work because we set a large max_message_size in the executor config";

    let options = create_empty_options();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(large_packet.clone(), options, false);

    // Should work with large message
    let expected_total_fee = DVN_FEE + EXECUTOR_FEE + TREASURY_FEE;
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'incorrect fee w/ large message',
    );
}

// Error test cases
#[test]
#[feature("safe_dispatcher")]
fn test_send_fails_when_not_called_by_endpoint() {
    let (_, message_lib_safe, admin, contract_address, _) = deploy_ultra_light_node_302(
        TREASURY_FEE,
    );
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as non-endpoint (should fail)
    cheat_caller_address_once(contract_address, NON_ENDPOINT);
    let result = message_lib_safe.send(packet, options, false);
    assert_panic_with_error(result, err_caller_not_endpoint(NON_ENDPOINT, ENDPOINT));
}

#[test]
#[feature("safe_dispatcher")]
fn test_send_fails_with_unsupported_eid() {
    let (_, message_lib_safe, _, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);

    // Don't set up any default config, so EID is unsupported
    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as endpoint - should fail because no default config means no DVNs
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib_safe.send(packet, options, false);
    assert_panic_with_error(result, err_must_have_at_least_one_dvn());
}

#[test]
#[feature("safe_dispatcher")]
fn test_send_fails_with_message_too_large() {
    let (_, message_lib_safe, admin, contract_address, _) = deploy_ultra_light_node_302(
        TREASURY_FEE,
    );
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    let small_max_size = 10_u32;
    let default_config = create_test_uln_config(array![dvn_address], array![], 0);
    let config_params = array![SetDefaultUlnConfigParam { eid: DST_EID, config: default_config }];

    // Setup default config with small max message size
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_send_configs(config_params);

    let executor_config = ExecutorConfig {
        max_message_size: small_max_size, executor: executor_address,
    };

    cheat_caller_address_once(contract_address, OWNER);
    admin
        .set_default_executor_configs(
            array![SetDefaultExecutorConfigParam { dst_eid: DST_EID, config: executor_config }],
        );

    // Create packet with message larger than max_message_size
    let mut large_packet = create_test_packet();
    large_packet
        .message =
            "This message is definitely longer than 10 characters and should trigger the message too large error";

    let options = create_empty_options();

    // Call send as endpoint - should failwith message too large error
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib_safe.send(large_packet.clone(), options, false);
    assert_panic_with_error(
        result, err_message_too_large(large_packet.message.len(), small_max_size.into()),
    );
}

#[test]
fn test_send_events_emitted_correctly() {
    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        TREASURY_FEE,
    );
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    let mut spy = spy_events();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    message_lib.send(packet.clone(), options, false);

    // Verify all three events were emitted in correct order
    let packet_header = create_packet_header_from_packet(@packet);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DvnFeesPaid(
                        DvnFeesPaid {
                            oapp: SENDER,
                            payees: array![
                                Payee {
                                    receiver: dvn_address,
                                    native_amount: DVN_FEE,
                                    lz_token_amount: 0,
                                },
                            ],
                            packet_header: packet_header.clone(),
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::ExecutorFeePaid(
                        ExecutorFeePaid {
                            oapp: SENDER,
                            payee: Payee {
                                receiver: executor_address,
                                native_amount: EXECUTOR_FEE,
                                lz_token_amount: 0,
                            },
                            packet_header: packet_header.clone(),
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::TreasuryFeePaid(
                        TreasuryFeePaid {
                            oapp: SENDER,
                            payee: Payee {
                                receiver: treasury, native_amount: TREASURY_FEE, lz_token_amount: 0,
                            },
                            packet_header: packet_header.clone(),
                        },
                    ),
                ),
            ],
        );
}

#[test]
#[feature("safe_dispatcher")]
fn test_send_with_mock_dvn_failure() {
    let (_, message_lib_safe, admin, contract_address, _) = deploy_ultra_light_node_302(
        TREASURY_FEE,
    );
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    // Make DVN fail
    let dvn_helpers = IMockDVNHelpersDispatcher { contract_address: dvn_address };
    dvn_helpers.set_should_fail(true);

    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as endpoint - should fail because DVN is configured to fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib_safe.send(packet, options, false);
    assert(result.is_err(), 'send should fail when DVN fails');
}

#[test]
#[feature("safe_dispatcher")]
fn test_send_with_mock_executor_failure() {
    let (_, message_lib_safe, admin, contract_address, _) = deploy_ultra_light_node_302(
        TREASURY_FEE,
    );
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    // Make executor fail
    let executor_helpers = IMockExecutorHelpersDispatcher { contract_address: executor_address };
    executor_helpers.set_should_fail(true);

    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as endpoint - should fail because executor is configured to fail
    cheat_caller_address_once(contract_address, ENDPOINT);
    let result = message_lib_safe.send(packet, options, false);
    assert(result.is_err(), 'executor fail -> send fail');
}

#[test]
fn test_send_returns_correct_encoded_packet() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    // Call send as endpoint
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        encoded_packet, ..,
    } = message_lib.send(packet.clone(), options, false);

    // Verify encoded packet is not empty and contains expected data
    assert_ne!(encoded_packet.len(), 0);

    // Now we can actually decode and verify the packet contents
    let decoded_packet = PacketV1Codec::decode(@encoded_packet);

    // Verify all fields match the original packet
    assert(decoded_packet.nonce == packet.nonce, 'nonce mismatch');
    assert(decoded_packet.src_eid == packet.src_eid, 'src_eid mismatch');
    assert(decoded_packet.sender == packet.sender, 'sender mismatch');
    assert(decoded_packet.dst_eid == packet.dst_eid, 'dst_eid mismatch');
    assert(decoded_packet.receiver == packet.receiver, 'receiver mismatch');
    assert(decoded_packet.guid == packet.guid, 'guid mismatch');
    assert(decoded_packet.message == packet.message, 'message mismatch');
}

#[test]
fn test_send_with_different_senders() {
    let (message_lib, _, admin, contract_address, _) = deploy_ultra_light_node_302(TREASURY_FEE);
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    // Setup default config
    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let sender1: ContractAddress = 'sender1'.try_into().unwrap();
    let sender2: ContractAddress = 'sender2'.try_into().unwrap();

    let mut packet1 = create_test_packet();
    packet1.sender = sender1;

    let mut packet2 = create_test_packet();
    packet2.sender = sender2;

    let options = create_empty_options();

    let mut spy = spy_events();

    // Call send as endpoint for both packets
    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet1.clone(), options.clone(), false);

    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt: receipt2, ..,
    } = message_lib.send(packet2.clone(), options, false);

    // Both should work and have the same fees
    assert(
        total_native_fee_from_receipt(@message_receipt) == total_native_fee_from_receipt(@receipt2),
        'fees should be equal',
    );

    // Verify events were emitted for both senders
    let packet_header1 = create_packet_header_from_packet(@packet1);
    let packet_header2 = create_packet_header_from_packet(@packet2);
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::DvnFeesPaid(
                        DvnFeesPaid {
                            oapp: sender1,
                            payees: array![
                                Payee {
                                    receiver: dvn_address,
                                    native_amount: DVN_FEE,
                                    lz_token_amount: 0,
                                },
                            ],
                            packet_header: packet_header1,
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::DvnFeesPaid(
                        DvnFeesPaid {
                            oapp: sender2,
                            payees: array![
                                Payee {
                                    receiver: dvn_address,
                                    native_amount: DVN_FEE,
                                    lz_token_amount: 0,
                                },
                            ],
                            packet_header: packet_header2,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_send_native_cap_with_small_fees() {
    // Use small DVN/executor fees so cap actually applies
    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        TREASURY_FEE_ABOVE_CAP,
    );
    let dvn_address = deploy_mock_dvn(10); // Small DVN fee
    let executor_address = deploy_mock_executor(20); // Small executor fee

    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // DVN=10, executor=20, total_other_fees=30, cap=200, treasury_quote=500
    // max_native_fee = max(30, 200) = 200
    // actual_treasury_fee = min(500, 200) = 200 (capped!)
    let expected_total_fee = 10 + 20 + 200; // 230
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'treasury fee capped',
    );

    // Verify treasury payee has capped amount
    let treasury_payee = message_receipt.payees.at(2); // Treasury is third payee
    assert(*treasury_payee.receiver == treasury, 'wrong treasury receiver');
    assert(*treasury_payee.native_amount == 200, 'treasury amount capped');
}

#[test]
fn test_send_native_cap_normal_operation() {
    // Normal operation where treasury fee is below cap
    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        TREASURY_FEE,
    );
    let dvn_address = deploy_mock_dvn(DVN_FEE);
    let executor_address = deploy_mock_executor(EXECUTOR_FEE);

    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // DVN=1000, executor=2000, total_other_fees=3000, cap=200, treasury_quote=50
    // max_native_fee = max(3000, 200) = 3000
    // actual_treasury_fee = min(50, 3000) = 50 (not capped)
    let expected_total_fee = DVN_FEE + EXECUTOR_FEE + TREASURY_FEE; // 1000 + 2000 + 50 = 3050
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'normal treasury fee op',
    );

    // Verify treasury payee has correct amount
    let treasury_payee = message_receipt.payees.at(2);
    assert(*treasury_payee.receiver == treasury, 'wrong treasury receiver');
    assert(*treasury_payee.native_amount == TREASURY_FEE, 'wrong treasury amount');
}

#[test]
fn test_send_native_cap_at_threshold() {
    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        TREASURY_FEE_AT_CAP,
    );
    let dvn_address = deploy_mock_dvn(100); // DVN fee
    let executor_address = deploy_mock_executor(100); // Executor fee

    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // DVN=100, executor=100, total_other_fees=200, cap=200, treasury_quote=200
    // max_native_fee = max(200, 200) = 200
    // actual_treasury_fee = min(200, 200) = 200
    let expected_total_fee = 100 + 100 + 200; // 400
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'treasury fee at cap',
    );

    // Verify treasury payee has correct amount
    let treasury_payee = message_receipt.payees.at(2);
    assert(*treasury_payee.receiver == treasury, 'wrong treasury receiver');
    assert(*treasury_payee.native_amount == TREASURY_FEE_AT_CAP, 'wrong treasury at cap');
}

#[test]
fn test_send_native_cap_above_threshold() {
    // Test scenario where total_other_fees significantly exceeds treasury_native_fee_cap
    // This tests the case where max_native_fee is driven by total_other_fees, not the cap
    let treasury_quote = 1000_u256; // Above cap but below total_other_fees
    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        treasury_quote,
    );

    // Use high DVN and executor fees so total_other_fees >> cap
    let high_dvn_fee = 2000_u256;
    let high_executor_fee = 3000_u256;
    let dvn_address = deploy_mock_dvn(high_dvn_fee);
    let executor_address = deploy_mock_executor(high_executor_fee);

    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, false);

    // DVN=2000, executor=3000, total_other_fees=5000, cap=200, treasury_quote=1000
    // max_native_fee = max(5000, 200) = 5000 (driven by total_other_fees, well above cap)
    // actual_treasury_fee = min(1000, 5000) = 1000 (limited by quote, not by max_native_fee)
    let expected_total_fee = high_dvn_fee
        + high_executor_fee
        + treasury_quote; // 2000 + 3000 + 1000 = 6000
    assert(
        total_native_fee_from_receipt(@message_receipt) == expected_total_fee,
        'treasury fee above threshold',
    );

    // Verify treasury payee has the quote amount (not capped by max_native_fee)
    let treasury_payee = message_receipt.payees.at(2);
    assert(*treasury_payee.receiver == treasury, 'wrong treasury receiver');
    assert(*treasury_payee.native_amount == treasury_quote, 'wrong treasury above threshold');
}

#[test]
#[fuzzer(runs: 10)]
fn test_send_treasury_fee_in_lz_tokens(
    native_treasury_fee: u64, lz_token_treasury_fee: u64, dvn_fee: u64, executor_fee: u64,
) {
    let dvn_fee = dvn_fee.into();
    let executor_fee = executor_fee.into();
    let native_treasury_fee = native_treasury_fee.into();
    let lz_token_treasury_fee = lz_token_treasury_fee.into();

    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        native_treasury_fee,
    );

    IMockTreasuryHelpersDispatcher { contract_address: treasury }
        .set_lz_token_fee(Some(lz_token_treasury_fee));

    let dvn_address = deploy_mock_dvn(dvn_fee);
    let executor_address = deploy_mock_executor(executor_fee);

    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, true);
    let payees = message_receipt.payees;
    let payee = {
        let mut iterator = payees.into_iter();
        iterator.find(|payee| *payee.receiver == treasury).unwrap()
    };

    assert(payee.native_amount == 0, 'non-zero native fee');
    assert(payee.lz_token_amount == lz_token_treasury_fee, 'unexpected LZ token fee');
}

#[test]
#[fuzzer(runs: 10)]
fn test_send_uncapped_treasury_fee_in_lz_tokens(
    native_treasury_fee: u64, dvn_fee: u64, executor_fee: u64,
) {
    let native_treasury_fee = native_treasury_fee.into();
    let dvn_fee = dvn_fee.into();
    let executor_fee = executor_fee.into();

    let (message_lib, _, admin, contract_address, treasury) = deploy_ultra_light_node_302(
        native_treasury_fee,
    );

    IMockTreasuryHelpersDispatcher { contract_address: treasury }
        .set_lz_token_fee(Some(Bounded::MAX));

    let dvn_address = deploy_mock_dvn(dvn_fee);
    let executor_address = deploy_mock_executor(executor_fee);

    setup_default_config_with_mocks(
        admin, contract_address, DST_EID, array![dvn_address], array![], 0, executor_address,
    );

    let packet = create_test_packet();
    let options = create_empty_options();

    cheat_caller_address_once(contract_address, ENDPOINT);
    let MessageLibSendResult {
        message_receipt, ..,
    } = message_lib.send(packet.clone(), options, true);
    let payees = message_receipt.payees;
    let payee = {
        let mut iterator = payees.into_iter();
        iterator.find(|payee| *payee.receiver == treasury).unwrap()
    };

    assert(payee.native_amount == 0, 'non-zero native fee');
    assert(payee.lz_token_amount == Bounded::MAX, 'unexpected LZ token fee');
}
