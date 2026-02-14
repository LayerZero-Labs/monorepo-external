//! ULN receive tests

use PacketV1Codec::{
    PACKET_HEADER_LENGTH, err_invalid_eid, err_invalid_packet_header, err_invalid_packet_version,
};
use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::common::structs::packet::Packet;
use layerzero::endpoint::constants::EMPTY_PAYLOAD_HASH;
use layerzero::message_lib::interface::{
    IMessageLibDispatcher, IMessageLibDispatcherTrait, IMessageLibSafeDispatcher,
    IMessageLibSafeDispatcherTrait, VerificationState,
};
use layerzero::message_lib::uln_302::errors::err_uln_verifying;
use layerzero::message_lib::uln_302::events::PayloadVerified;
use layerzero::message_lib::uln_302::interface::{
    IUltraLightNode302AdminDispatcher, IUltraLightNode302AdminDispatcherTrait,
    IUltraLightNode302AdminSafeDispatcher,
};
use layerzero::message_lib::uln_302::structs::uln_config::{SetDefaultUlnConfigParam, UlnConfig};
use layerzero::message_lib::uln_302::ultra_light_node_302::UltraLightNode302;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_mock_call,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::constants::assert_eq;

// Import shared test utils
use crate::message_lib::uln_302::utils::set_oapp_uln_receive_config_via_message_lib;

// Test constants
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const RECEIVER: ContractAddress = 'receiver'.try_into().unwrap();
pub const SENDER: ContractAddress = 'sender'.try_into().unwrap();
pub const DVN_1: ContractAddress = 'dvn_1'.try_into().unwrap();
pub const DVN_2: ContractAddress = 'dvn_2'.try_into().unwrap();
pub const DVN_3: ContractAddress = 'dvn_3'.try_into().unwrap();
pub const SRC_EID: u32 = 1;
pub const DST_EID: u32 = 2; // This will be the local EID for receive tests
pub const CONFIRMATIONS: u64 = 20;
pub const TREASURY_FEE: u256 = 300;
pub const TREASURY_NATIVE_FEE_CAP: u256 = 100;
pub const INVALID_EID: u32 = 999;

// Helper functions
fn deploy_ultra_light_node_302() -> (
    IMessageLibDispatcher,
    IMessageLibSafeDispatcher,
    IUltraLightNode302AdminDispatcher,
    IUltraLightNode302AdminSafeDispatcher,
    ContractAddress,
    ContractAddress,
) {
    let contract = declare("UltraLightNode302").unwrap_syscall().contract_class();
    let treasury = deploy_mock_treasury(TREASURY_FEE);
    let endpoint = deploy_mock_endpoint(DST_EID);
    let mut constructor_calldata = array![OWNER.into(), treasury.into(), endpoint.into()];
    TREASURY_NATIVE_FEE_CAP.serialize(ref constructor_calldata);
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    let message_lib = IMessageLibDispatcher { contract_address };
    let message_lib_safe = IMessageLibSafeDispatcher { contract_address };
    let admin = IUltraLightNode302AdminDispatcher { contract_address };
    let admin_safe = IUltraLightNode302AdminSafeDispatcher { contract_address };

    (message_lib, message_lib_safe, admin, admin_safe, contract_address, endpoint)
}

fn deploy_mock_treasury(treasury_fee: u256) -> ContractAddress {
    let contract = declare("MockTreasury").unwrap_syscall().contract_class();
    let constructor_calldata = array![treasury_fee.low.into(), treasury_fee.high.into()];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    address
}

fn deploy_mock_endpoint(eid: u32) -> ContractAddress {
    let contract = declare("MockEndpointV2").unwrap_syscall().contract_class();
    let constructor_calldata = array![eid.into()];
    let (address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    address
}

fn create_required_dvns() -> Array<ContractAddress> {
    array![DVN_1, DVN_2]
}

fn create_optional_dvns() -> Array<ContractAddress> {
    array![DVN_3]
}

fn create_test_uln_config() -> UlnConfig {
    UlnConfig {
        confirmations: CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: create_required_dvns(),
        has_required_dvns: true,
        optional_dvns: create_optional_dvns(),
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    }
}

fn create_only_required_dvns_config() -> UlnConfig {
    UlnConfig {
        confirmations: CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: create_required_dvns(),
        has_required_dvns: true,
        optional_dvns: array![],
        optional_dvn_threshold: 0,
        has_optional_dvns: true,
    }
}

fn create_only_optional_dvns_config() -> UlnConfig {
    UlnConfig {
        confirmations: CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns: create_optional_dvns(),
        optional_dvn_threshold: 1,
        has_optional_dvns: true,
    }
}

// Helper function to create a valid packet
fn create_test_packet() -> Packet {
    let receiver_felt: felt252 = RECEIVER.try_into().unwrap();
    Packet {
        nonce: 123,
        src_eid: SRC_EID,
        sender: SENDER,
        dst_eid: DST_EID,
        receiver: Bytes32 { value: receiver_felt.into() },
        guid: Bytes32 { value: 0x987654321 },
        message: "test message",
    }
}

// Helper function to create a packet with invalid version (we'll modify the header after encoding)
fn create_invalid_version_packet() -> Packet {
    let receiver_felt: felt252 = RECEIVER.try_into().unwrap();
    Packet {
        nonce: 123,
        src_eid: SRC_EID,
        sender: SENDER,
        dst_eid: DST_EID,
        receiver: Bytes32 { value: receiver_felt.into() },
        guid: Bytes32 { value: 0x987654321 },
        message: "test message",
    }
}

// Helper function to create a packet with invalid EID
fn create_invalid_eid_packet() -> Packet {
    let receiver_felt: felt252 = RECEIVER.try_into().unwrap();
    Packet {
        nonce: 123,
        src_eid: SRC_EID,
        sender: SENDER,
        dst_eid: INVALID_EID, // wrong EID
        receiver: Bytes32 { value: receiver_felt.into() },
        guid: Bytes32 { value: 0x987654321 },
        message: "test message",
    }
}

// Helper function to create a valid packet header using PacketV1Codec
fn create_packet_header() -> ByteArray {
    let packet = create_test_packet();
    PacketV1Codec::encode_header(@packet)
}

fn create_invalid_version_header() -> ByteArray {
    let packet = create_invalid_version_packet();
    let mut header = PacketV1Codec::encode_header(@packet);

    // Manually corrupt the version byte (first byte) to make it invalid
    let mut corrupted_header: ByteArray = Default::default();
    corrupted_header.append_u8(2); // invalid version (should be 1)

    // Copy the rest of the header (skip the first byte)
    let (_, rest_of_header) = header.read_bytes(1, 80); // 81 - 1 = 80 bytes
    corrupted_header.append(@rest_of_header);

    corrupted_header
}

fn create_invalid_eid_header() -> ByteArray {
    let packet = create_invalid_eid_packet();
    PacketV1Codec::encode_header(@packet)
}

fn create_short_header() -> ByteArray {
    let mut header: ByteArray = Default::default();
    header.append_u8(1); // version - only 1 byte instead of required 81
    header
}

fn setup_default_receive_config(
    admin: IUltraLightNode302AdminDispatcher, contract_address: ContractAddress, src_eid: u32,
) {
    let default_config = create_test_uln_config();
    let config_params = array![SetDefaultUlnConfigParam { eid: src_eid, config: default_config }];
    cheat_caller_address_once(contract_address, OWNER);
    admin.set_default_uln_receive_configs(config_params);
}

// Test cases for verify function
#[test]
fn test_verify_stores_verification_correctly() {
    let (message_lib, _, _, _, contract_address, _) = deploy_ultra_light_node_302();
    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };
    let confirmations = 25_u64;

    // Set up event spy
    let mut spy = spy_events();

    // Call verify as DVN_1
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, confirmations);

    // Verify event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::PayloadVerified(
                        PayloadVerified {
                            dvn: DVN_1,
                            header: packet_header,
                            confirmations: confirmations.into(),
                            proof_hash: payload_hash,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_verify_multiple_dvns_same_payload() {
    let (message_lib, _, _, _, contract_address, _) = deploy_ultra_light_node_302();
    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };
    let confirmations1 = 25_u64;
    let confirmations2 = 30_u64;

    // Set up event spy
    let mut spy = spy_events();

    // Call verify as DVN_1
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, confirmations1);

    // Call verify as DVN_2 with different confirmations
    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, confirmations2);

    // Verify both events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::PayloadVerified(
                        PayloadVerified {
                            dvn: DVN_1,
                            header: packet_header.clone(),
                            confirmations: confirmations1.into(),
                            proof_hash: payload_hash,
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::PayloadVerified(
                        PayloadVerified {
                            dvn: DVN_2,
                            header: packet_header,
                            confirmations: confirmations2.into(),
                            proof_hash: payload_hash,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_verify_same_dvn_can_overwrite_verification() {
    let (message_lib, _, _, _, contract_address, _) = deploy_ultra_light_node_302();
    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };
    let confirmations1 = 25_u64;
    let confirmations2 = 35_u64;

    // Set up event spy
    let mut spy = spy_events();

    // Call verify as DVN_1 first time
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, confirmations1);

    // Call verify as DVN_1 second time with different confirmations
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, confirmations2);

    // Verify both events were emitted (second one overwrites first)
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    UltraLightNode302::Event::PayloadVerified(
                        PayloadVerified {
                            dvn: DVN_1,
                            header: packet_header.clone(),
                            confirmations: confirmations1.into(),
                            proof_hash: payload_hash,
                        },
                    ),
                ),
                (
                    contract_address,
                    UltraLightNode302::Event::PayloadVerified(
                        PayloadVerified {
                            dvn: DVN_1,
                            header: packet_header,
                            confirmations: confirmations2.into(),
                            proof_hash: payload_hash,
                        },
                    ),
                ),
            ],
        );
}

// Test cases for commit function
#[test]
fn test_commit_success_with_required_dvns_only() {
    let (message_lib, _, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver with only required DVNs
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_only_required_dvns_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Both required DVNs verify with sufficient confirmations
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Now commit should succeed
    message_lib.commit(packet_header, payload_hash);
}

#[test]
fn test_commit_success_with_optional_dvns_only() {
    let (message_lib, _, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver with only optional DVNs
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_only_optional_dvns_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Optional DVN verifies with sufficient confirmations (threshold = 1)
    cheat_caller_address_once(contract_address, DVN_3);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Now commit should succeed
    message_lib.commit(packet_header, payload_hash);
}

#[test]
fn test_commit_success_with_mixed_dvns() {
    let (message_lib, _, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver with both required and optional DVNs
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_test_uln_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Both required DVNs verify
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Optional DVN also verifies (threshold = 1)
    cheat_caller_address_once(contract_address, DVN_3);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Now commit should succeed
    message_lib.commit(packet_header, payload_hash);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_fails_when_required_dvn_missing() {
    let (message_lib, message_lib_safe, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver with only required DVNs
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_only_required_dvns_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Only one required DVN verifies (DVN_2 is missing)
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Commit should fail because DVN_2 hasn't verified
    let result = message_lib_safe.commit(packet_header, payload_hash);
    assert_panic_with_error(result, err_uln_verifying());
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_fails_when_optional_threshold_not_met() {
    let (message_lib, message_lib_safe, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config with higher optional threshold
    let config_with_high_threshold = UlnConfig {
        confirmations: CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: array![],
        has_required_dvns: true,
        optional_dvns: array![DVN_1, DVN_2, DVN_3],
        optional_dvn_threshold: 2, // Need 2 out of 3
        has_optional_dvns: true,
    };

    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, config_with_high_threshold,
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Only one optional DVN verifies (need 2)
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Commit should fail because optional threshold not met
    let result = message_lib_safe.commit(packet_header, payload_hash);
    assert_panic_with_error(result, err_uln_verifying());
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_fails_when_insufficient_confirmations() {
    let (message_lib, message_lib_safe, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_only_required_dvns_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // DVNs verify with insufficient confirmations
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS - 1); // Not enough

    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS - 1); // Not enough

    // Commit should fail because confirmations are insufficient
    let result = message_lib_safe.commit(packet_header, payload_hash);
    assert_panic_with_error(result, err_uln_verifying());
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_success_with_higher_confirmations() {
    let (message_lib, message_lib_safe, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_only_required_dvns_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // DVNs verify with more confirmations than required
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS + 10);

    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS + 5);

    // Commit should succeed because confirmations exceed requirement
    let result = message_lib_safe.commit(packet_header, payload_hash);
    assert(result.is_ok(), 'Commit should succeed');
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_fails_with_invalid_packet_header_version() {
    let (_, message_lib_safe, _, _, _, _) = deploy_ultra_light_node_302();
    let invalid_header = create_invalid_version_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Commit should fail due to invalid version
    let result = message_lib_safe.commit(invalid_header, payload_hash);
    assert_panic_with_error(result, err_invalid_packet_version(2));
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_fails_with_invalid_packet_header_length() {
    let (_, message_lib_safe, _, _, _, _) = deploy_ultra_light_node_302();
    let short_header = create_short_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Commit should fail due to invalid header length
    let result = message_lib_safe.commit(short_header.clone(), payload_hash);
    assert_panic_with_error(
        result, err_invalid_packet_header(PACKET_HEADER_LENGTH, short_header.len()),
    );
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_fails_with_invalid_eid() {
    let (_, message_lib_safe, _, _, _, _) = deploy_ultra_light_node_302();
    let invalid_eid_header = create_invalid_eid_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Commit should fail due to wrong destination EID
    let result = message_lib_safe.commit(invalid_eid_header, payload_hash);
    assert_panic_with_error(result, err_invalid_eid(DST_EID, INVALID_EID));
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_clears_verification_storage() {
    let (message_lib, message_lib_safe, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_test_uln_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // All DVNs verify
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    cheat_caller_address_once(contract_address, DVN_3);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Commit should succeed and clear storage
    let result = message_lib_safe.commit(packet_header.clone(), payload_hash);
    assert(result.is_ok(), 'Commit should succeed');

    // Trying to commit again should fail because storage was cleared
    let result = message_lib_safe.commit(packet_header, payload_hash);
    assert_panic_with_error(result, err_uln_verifying());
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_success_with_mixed_confirmations() {
    let (message_lib, message_lib_safe, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_test_uln_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // DVNs verify with different confirmations (all >= required)
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS); // exactly required

    cheat_caller_address_once(contract_address, DVN_2);
    message_lib
        .verify(packet_header.clone(), payload_hash, CONFIRMATIONS + 5); // more than required

    cheat_caller_address_once(contract_address, DVN_3);
    message_lib
        .verify(packet_header.clone(), payload_hash, CONFIRMATIONS + 10); // much more than required

    // Commit should succeed
    let result = message_lib_safe.commit(packet_header, payload_hash);
    assert(result.is_ok(), 'Commit should succeed');
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_success_with_partial_optional_verification() {
    let (message_lib, message_lib_safe, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up config with multiple optional DVNs but low threshold
    let config_with_multiple_optional = UlnConfig {
        confirmations: CONFIRMATIONS,
        has_confirmations: true,
        required_dvns: array![DVN_1],
        has_required_dvns: true,
        optional_dvns: array![DVN_2, DVN_3],
        optional_dvn_threshold: 1, // Only need 1 out of 2
        has_optional_dvns: true,
    };

    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, config_with_multiple_optional,
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Required DVN verifies
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Only one optional DVN verifies (threshold = 1)
    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);
    // DVN_3 doesn't verify

    // Commit should succeed because threshold is met
    let result = message_lib_safe.commit(packet_header, payload_hash);
    assert(result.is_ok(), 'Commit should succeed');
}

// ================================ Test Verifiable ================================================

#[test]
fn test_verifiable_not_initializable() {
    let (message_lib, _, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // initializable returns false
    start_mock_call(endpoint_address, selector!("initializable"), false);
    let result = message_lib.verifiable(packet_header, payload_hash);
    assert_eq(result, VerificationState::NotInitializable);
}

#[test]
fn test_verifiable_verified() {
    let (message_lib, _, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);
    let packet_header = create_packet_header();

    start_mock_call(endpoint_address, selector!("initializable"), true);

    // On empty payload hash
    let result = message_lib.verifiable(packet_header.clone(), EMPTY_PAYLOAD_HASH);
    assert_eq(result, VerificationState::Verified);

    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // On verifiable with receive lib false
    start_mock_call(endpoint_address, selector!("verifiable_with_receive_lib"), false);
    let result = message_lib.verifiable(packet_header.clone(), payload_hash);
    assert_eq(result, VerificationState::Verified);

    // On verifiable with receive lib true and payload hash matches
    start_mock_call(endpoint_address, selector!("verifiable_with_receive_lib"), true);
    start_mock_call(endpoint_address, selector!("inbound_payload_hash"), payload_hash);
    let result = message_lib.verifiable(packet_header, payload_hash);
    assert_eq(result, VerificationState::Verified);
}

#[test]
fn test_verifiable_verifying() {
    let (message_lib, _, admin, _, contract_address, endpoint_address) =
        deploy_ultra_light_node_302();
    setup_default_receive_config(admin, contract_address, SRC_EID);

    // Set up receive config for the receiver
    cheat_caller_address_once(contract_address, endpoint_address);
    set_oapp_uln_receive_config_via_message_lib(
        contract_address, RECEIVER, SRC_EID, create_test_uln_config(),
    );

    let packet_header = create_packet_header();
    let payload_hash = Bytes32 { value: 0x123456789abcdef };

    // Two DVNs verify
    cheat_caller_address_once(contract_address, DVN_1);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    cheat_caller_address_once(contract_address, DVN_2);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Should be verifying
    // On verifiable with receive lib true and payload hash matches
    start_mock_call(endpoint_address, selector!("verifiable_with_receive_lib"), true);
    start_mock_call(endpoint_address, selector!("inbound_payload_hash"), EMPTY_PAYLOAD_HASH);

    let result = message_lib.verifiable(packet_header.clone(), payload_hash);
    assert_eq(result, VerificationState::Verifying);

    // Now All DVNs verified
    cheat_caller_address_once(contract_address, DVN_3);
    message_lib.verify(packet_header.clone(), payload_hash, CONFIRMATIONS);

    // Should be verifiable
    let result = message_lib.verifiable(packet_header, payload_hash);
    assert_eq(result, VerificationState::Verifiable);
}

