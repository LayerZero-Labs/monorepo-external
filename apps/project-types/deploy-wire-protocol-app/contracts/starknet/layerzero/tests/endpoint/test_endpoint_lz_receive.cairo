//! Test endpoint lz_receive

use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::endpoint_v2::EndpointV2;
use layerzero::endpoint::errors;
use layerzero::endpoint::errors::{err_lz_receive_value_exceeds_allowance, err_unauthorized};
use layerzero::endpoint::events::PacketDelivered;
use layerzero::endpoint::interfaces::endpoint_v2::{
    IEndpointV2SafeDispatcher, IEndpointV2SafeDispatcherTrait,
};
use layerzero::endpoint::message_lib_manager::interface::{
    IMessageLibManagerDispatcher, IMessageLibManagerDispatcherTrait,
};
use layerzero::endpoint::messaging_channel::errors::{err_invalid_nonce, err_payload_hash_not_found};
use layerzero::message_lib::structs::MessageLibType;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use lz_utils::keccak::keccak256;
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::e2e::utils::deploy_blocked_message_lib;
use crate::endpoint::utils::deploy_simple_message_lib;
use crate::mocks::receiver::MockReceiver::{
    IMockReceiverHelpersDispatcher, IMockReceiverHelpersDispatcherTrait,
};

// Test constants
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const SENDER: ContractAddress = 'sender'.try_into().unwrap();
pub const ANOTHER_SENDER: ContractAddress = 'another_sender'.try_into().unwrap();
pub const LIBRARY_ADDRESS: ContractAddress = 'library'.try_into().unwrap();
pub const NON_OWNER: ContractAddress = 'non_owner'.try_into().unwrap();
pub const MESSAGE_LIB: ContractAddress = 'msglib'.try_into().unwrap();
pub const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
pub const DELEGATE: ContractAddress = 'delegate'.try_into().unwrap();
pub const EID: u32 = 1;
pub const SRC_EID: u32 = 2;

// Token amounts
pub const INITIAL_SUPPLY: u256 = 1000000_u256; // 1M tokens
pub const EXECUTOR_INITIAL_BALANCE: u256 = 10000_u256; // 10K tokens

// Test assert message constants
pub const REGISTER_LIBRARY_FAILED: felt252 = 'registerLibrary failed';
pub const SET_RECEIVE_LIBRARY_FAILED: felt252 = 'setReceiveLibrary failed';
pub const COMMIT_SHOULD_SUCCEED: felt252 = 'Commit should succeed';
pub const LZ_RECEIVE_SHOULD_SUCCEED: felt252 = 'lz_receive should succeed';
pub const LZ_RECEIVE_SHOULD_FAIL: felt252 = 'lz_receive should fail';

fn deploy_mock_erc20() -> (IERC20Dispatcher, ContractAddress) {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        INITIAL_SUPPLY.low.into(), INITIAL_SUPPLY.high.into(), OWNER.into(),
    ];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    (IERC20Dispatcher { contract_address }, contract_address)
}

fn deploy_endpoint() -> (IEndpointV2SafeDispatcher, ContractAddress) {
    let (_, token_address) = deploy_mock_erc20();
    let blocked_library = deploy_blocked_message_lib();
    let contract = declare("EndpointV2").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        OWNER.into(), EID.into(), token_address.into(), blocked_library.into(),
    ];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    (IEndpointV2SafeDispatcher { contract_address }, contract_address)
}

fn deploy_endpoint_with_token() -> (
    IEndpointV2SafeDispatcher, ContractAddress, IERC20Dispatcher, ContractAddress,
) {
    let (token, token_address) = deploy_mock_erc20();
    let blocked_library = deploy_blocked_message_lib();
    let contract = declare("EndpointV2").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        OWNER.into(), EID.into(), token_address.into(), blocked_library.into(),
    ];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    (IEndpointV2SafeDispatcher { contract_address }, contract_address, token, token_address)
}

fn deploy_mock_receiver() -> (IMockReceiverHelpersDispatcher, ContractAddress) {
    let contract = declare("MockReceiver").unwrap_syscall().contract_class();
    let (receiver_address, _) = contract.deploy(@array![]).unwrap_syscall();
    let mock_dispatcher = IMockReceiverHelpersDispatcher { contract_address: receiver_address };
    mock_dispatcher.set_allow_initialize(true);
    (mock_dispatcher, receiver_address)
}

fn setup_tokens_and_balances(token: IERC20Dispatcher, endpoint_address: ContractAddress) {
    // Give tokens to EXECUTOR
    start_cheat_caller_address(token.contract_address, OWNER);
    token.transfer(EXECUTOR, EXECUTOR_INITIAL_BALANCE);
    stop_cheat_caller_address(token.contract_address);
}

fn register_library(
    endpoint: IEndpointV2SafeDispatcher,
    message_lib_manager_dispatcher: IMessageLibManagerDispatcher,
    endpoint_address: ContractAddress,
    sml_address: ContractAddress,
) {
    start_cheat_caller_address(endpoint_address, OWNER);
    // Satisfy registration-time type check
    start_mock_call(sml_address, selector!("message_lib_type"), MessageLibType::SendAndReceive);
    message_lib_manager_dispatcher.register_library(sml_address);
    stop_cheat_caller_address(endpoint_address);
}

struct SetupResult {
    endpoint: IEndpointV2SafeDispatcher,
    endpoint_address: ContractAddress,
    sml_address: ContractAddress,
    receiver: IMockReceiverHelpersDispatcher,
    receiver_address: ContractAddress,
    message_lib_manager_dispatcher: IMessageLibManagerDispatcher,
    token: IERC20Dispatcher,
    token_address: ContractAddress,
}

fn setup() -> SetupResult {
    let (endpoint, endpoint_address) = deploy_endpoint();
    let sml_address = deploy_simple_message_lib(endpoint_address);
    let message_lib_manager_dispatcher = IMessageLibManagerDispatcher {
        contract_address: endpoint_address,
    };
    register_library(endpoint, message_lib_manager_dispatcher, endpoint_address, sml_address);
    let (receiver, receiver_address) = deploy_mock_receiver();
    let fake_token_address = 'fake_token'.try_into().unwrap();
    let fake_token = IERC20Dispatcher { contract_address: fake_token_address };

    SetupResult {
        endpoint,
        endpoint_address,
        sml_address,
        receiver,
        receiver_address,
        message_lib_manager_dispatcher,
        token: fake_token,
        token_address: fake_token_address,
    }
}

fn setup_with_token() -> SetupResult {
    let (endpoint, endpoint_address, token, token_address) = deploy_endpoint_with_token();
    let sml_address = deploy_simple_message_lib(endpoint_address);
    let message_lib_manager_dispatcher = IMessageLibManagerDispatcher {
        contract_address: endpoint_address,
    };
    register_library(endpoint, message_lib_manager_dispatcher, endpoint_address, sml_address);
    let (receiver, receiver_address) = deploy_mock_receiver();

    // Setup token balances
    setup_tokens_and_balances(token, endpoint_address);

    SetupResult {
        endpoint,
        endpoint_address,
        sml_address,
        receiver,
        receiver_address,
        token,
        token_address,
        message_lib_manager_dispatcher,
    }
}

fn set_receive_library(
    endpoint_address: ContractAddress,
    receiver: ContractAddress,
    lib_address: ContractAddress,
    src_eid: u32,
    message_lib_manager_dispatcher: IMessageLibManagerDispatcher,
) {
    cheat_caller_address_once(endpoint_address, receiver);
    message_lib_manager_dispatcher.set_receive_library(receiver, src_eid, lib_address, 0);
}

fn create_test_prefix() -> Origin {
    Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 }
}

fn create_test_origin_with_nonce(nonce: u64) -> Origin {
    Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce }
}

fn create_test_origin_with_clone() -> (Origin, Origin) {
    return (create_test_prefix(), create_test_prefix());
}

fn create_test_payload_hash() -> Bytes32 {
    Bytes32 { value: 0x123456789abcdef_u256 }
}

fn create_test_message() -> ByteArray {
    "Hello LayerZero!"
}

fn create_test_guid() -> Bytes32 {
    Bytes32 { value: 0x987654321_u256 }
}

/// Helper function to create payload hash from guid + message (like Solidity's abi.encodePacked)
/// This matches the payload creation in the endpoint's _create_payload function
fn create_payload_hash(guid: Bytes32, message: @ByteArray) -> Bytes32 {
    let mut payload: ByteArray = "";

    // Append the 32-byte guid value
    payload.append_u256(guid.value);

    // Append the message
    payload.append(message);

    // Return the hash of the concatenated payload
    keccak256(@payload)
}

fn commit_message(
    endpoint: IEndpointV2SafeDispatcher,
    endpoint_address: ContractAddress,
    lib_address: ContractAddress,
    origin: Origin,
    receiver: ContractAddress,
    payload_hash: Bytes32,
) {
    cheat_caller_address_once(endpoint_address, lib_address);
    let _result = endpoint.verify(origin, receiver, payload_hash);
}

#[test]
fn test_lz_receive_success_single_message() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // First commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Now call lz_receive
    let mut spy = spy_events();
    let result = endpoint.lz_receive(origin.clone(), receiver_address, guid, message, "", 0);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check that PacketDelivered event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin, receiver: receiver_address },
                    ),
                ),
            ],
        );
}

#[test]
fn test_lz_receive_invalid_payload_hash() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // Commit the message with one payload hash
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Try to receive with a different message (different hash)
    let wrong_message = "Wrong message!";
    let wrong_hash = create_payload_hash(guid, @wrong_message);
    let result = endpoint.lz_receive(origin, receiver_address, guid, wrong_message, "", 0);

    // Should fail with payload hash not found error
    assert_panic_with_error(result, err_payload_hash_not_found(payload_hash, wrong_hash));
}

#[test]
fn test_lz_receive_invalid_nonce_gap() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // Commit message with nonce 1
    let origin1 = create_test_origin_with_nonce(1);
    commit_message(
        endpoint, endpoint_address, lib_address, origin1, receiver_address, payload_hash,
    );

    // Commit message with nonce 3 (skipping nonce 2)
    let origin3 = create_test_origin_with_nonce(3);
    commit_message(
        endpoint, endpoint_address, lib_address, origin3.clone(), receiver_address, payload_hash,
    );

    // Try to receive message with nonce 3 (should fail because nonce 2 is missing)
    let result = endpoint.lz_receive(origin3, receiver_address, guid, message, "", 0);
    assert_panic_with_error(result, err_invalid_nonce());
}

#[test]
fn test_lz_receive_sequential_messages() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    let mut spy = spy_events();

    // Commit and receive messages with nonces 1, 2, 3 in order
    for nonce in 1_u64..4 {
        let origin = create_test_origin_with_nonce(nonce);

        // Commit the message
        commit_message(
            endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
        );

        // Receive the message
        let result = endpoint
            .lz_receive(origin.clone(), receiver_address, guid, message.clone(), "", 0);
        assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);
    }

    // Check that all PacketDelivered events were emitted
    let mut expected_events = array![];
    for nonce in 1_u64..4 {
        let origin = create_test_origin_with_nonce(nonce);
        expected_events
            .append(
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin, receiver: receiver_address },
                    ),
                ),
            );
    }

    spy.assert_emitted(@expected_events);
}

#[test]
fn test_lz_receive_out_of_order_commit_in_order_receive() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // Commit messages out of order: 3, 1, 2
    let origin1 = create_test_origin_with_nonce(1);
    let origin2 = create_test_origin_with_nonce(2);
    let origin3 = create_test_origin_with_nonce(3);

    commit_message(
        endpoint, endpoint_address, lib_address, origin3.clone(), receiver_address, payload_hash,
    );
    commit_message(
        endpoint, endpoint_address, lib_address, origin1.clone(), receiver_address, payload_hash,
    );
    commit_message(
        endpoint, endpoint_address, lib_address, origin2.clone(), receiver_address, payload_hash,
    );

    let mut spy = spy_events();

    // Now receive in order: 1, 2, 3
    let result1 = endpoint
        .lz_receive(origin1.clone(), receiver_address, guid, message.clone(), "", 0);
    assert(result1.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);
    let result2 = endpoint
        .lz_receive(origin2.clone(), receiver_address, guid, message.clone(), "", 0);
    assert(result2.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);
    let result3 = endpoint.lz_receive(origin3.clone(), receiver_address, guid, message, "", 0);
    assert(result3.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check that all PacketDelivered events were emitted in order
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin1, receiver: receiver_address },
                    ),
                ),
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin2, receiver: receiver_address },
                    ),
                ),
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin3, receiver: receiver_address },
                    ),
                ),
            ],
        );
}

#[test]
fn test_lz_receive_batch_execution_random_order() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // Commit messages 1-5
    for nonce in 1_u64..6_u64 {
        let origin = create_test_origin_with_nonce(nonce);
        commit_message(
            endpoint, endpoint_address, lib_address, origin, receiver_address, payload_hash,
        );
    }

    let mut spy = spy_events();

    // Define a random execution order
    let random_order = array![3_u64, 1_u64, 5_u64, 2_u64, 4_u64];
    let mut expected_events = array![];

    // Execute in random order
    for i in 0..random_order.len() {
        let nonce = *random_order.at(i);
        let origin = create_test_origin_with_nonce(nonce);

        let result = endpoint
            .lz_receive(origin.clone(), receiver_address, guid, message.clone(), "", 0);
        assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

        // Add to expected events in execution order
        expected_events
            .append(
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin, receiver: receiver_address },
                    ),
                ),
            );
    }

    // Check that PacketDelivered events were emitted in the random execution order
    spy.assert_emitted(@expected_events);
}

#[test]
fn test_lz_receive_different_senders() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    let sender1: ContractAddress = 'sender1'.try_into().unwrap();
    let sender2: ContractAddress = 'sender2'.try_into().unwrap();

    // Create origins with different senders
    let origin1 = Origin { src_eid: SRC_EID, sender: sender1.into(), nonce: 1 };
    let origin2 = Origin { src_eid: SRC_EID, sender: sender2.into(), nonce: 1 };

    // Commit messages from both senders
    commit_message(
        endpoint, endpoint_address, lib_address, origin1.clone(), receiver_address, payload_hash,
    );
    commit_message(
        endpoint, endpoint_address, lib_address, origin2.clone(), receiver_address, payload_hash,
    );

    let mut spy = spy_events();

    // Receive messages from both senders
    let result1 = endpoint
        .lz_receive(origin1.clone(), receiver_address, guid, message.clone(), "", 0);
    assert(result1.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);
    let result2 = endpoint.lz_receive(origin2.clone(), receiver_address, guid, message, "", 0);
    assert(result2.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check that both PacketDelivered events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin1, receiver: receiver_address },
                    ),
                ),
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin2, receiver: receiver_address },
                    ),
                ),
            ],
        );
}

#[test]
fn test_lz_receive_different_source_eids() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    let src_eid1 = 101_u32;
    let src_eid2 = 102_u32;

    // Set receive library for both source EIDs
    set_receive_library(
        endpoint_address, receiver_address, lib_address, src_eid1, message_lib_manager_dispatcher,
    );
    set_receive_library(
        endpoint_address, receiver_address, lib_address, src_eid2, message_lib_manager_dispatcher,
    );

    // Create origins with different source EIDs
    let origin1 = Origin { src_eid: src_eid1, sender: SENDER.into(), nonce: 1 };
    let origin2 = Origin { src_eid: src_eid2, sender: SENDER.into(), nonce: 1 };

    // Commit messages from both source EIDs
    commit_message(
        endpoint, endpoint_address, lib_address, origin1.clone(), receiver_address, payload_hash,
    );
    commit_message(
        endpoint, endpoint_address, lib_address, origin2.clone(), receiver_address, payload_hash,
    );

    let mut spy = spy_events();

    // Receive messages from both source EIDs
    let result1 = endpoint
        .lz_receive(origin1.clone(), receiver_address, guid, message.clone(), "", 0);
    assert(result1.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);
    let result2 = endpoint.lz_receive(origin2.clone(), receiver_address, guid, message, "", 0);
    assert(result2.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check that both PacketDelivered events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin1, receiver: receiver_address },
                    ),
                ),
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin2, receiver: receiver_address },
                    ),
                ),
            ],
        );
}

#[test]
fn test_lz_receive_different_receivers() {
    let SetupResult {
        endpoint, endpoint_address, sml_address: lib_address, message_lib_manager_dispatcher, ..,
    } = setup();

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let origin = create_test_prefix();

    // Deploy multiple receivers
    let (_, receiver1) = deploy_mock_receiver();
    let (_, receiver2) = deploy_mock_receiver();

    // Set receive library for both receivers
    set_receive_library(
        endpoint_address, receiver1, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );
    set_receive_library(
        endpoint_address, receiver2, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    // Commit messages to both receivers
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver1, payload_hash,
    );
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver2, payload_hash,
    );

    let mut spy = spy_events();

    // Receive messages at both receivers
    let result1 = endpoint.lz_receive(origin.clone(), receiver1, guid, message.clone(), "", 0);
    assert(result1.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);
    let result2 = endpoint.lz_receive(origin.clone(), receiver2, guid, message, "", 0);
    assert(result2.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check that both PacketDelivered events were emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin: origin.clone(), receiver: receiver1 },
                    ),
                ),
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin, receiver: receiver2 },
                    ),
                ),
            ],
        );
}

#[test]
fn test_lz_receive_clears_payload_hash() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Receive the message (should clear the payload hash)
    let result = endpoint
        .lz_receive(origin.clone(), receiver_address, guid, message.clone(), "", 0);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Try to receive the same message again (should fail because payload hash was cleared)
    let result = endpoint.lz_receive(origin, receiver_address, guid, message.clone(), "", 0);

    // Should fail because the payload hash was cleared (now default/zero)
    let expected_hash = Default::default(); // Zero hash after clearing
    assert_panic_with_error(result, err_payload_hash_not_found(expected_hash, payload_hash));
}

#[test]
fn test_lz_receive_with_no_value() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    let mut spy = spy_events();

    // Receive the message with value
    let result = endpoint.lz_receive(origin.clone(), receiver_address, guid, message, "", 0);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check that PacketDelivered event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketDelivered(
                        PacketDelivered { origin, receiver: receiver_address },
                    ),
                ),
            ],
        );
}

#[test]
fn test_lz_receive_token_transfer_success() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let value = 1000_u256;

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Give executor allowance to spend tokens
    cheat_caller_address_once(token.contract_address, EXECUTOR);
    token.approve(endpoint_address, value);

    // Record initial balances
    let executor_balance_before = token.balance_of(EXECUTOR);
    let receiver_balance_before = token.balance_of(receiver_address);

    // Call lz_receive as executor
    cheat_caller_address_once(endpoint_address, EXECUTOR);
    let result = endpoint.lz_receive(origin.clone(), receiver_address, guid, message, "", value);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check balances after transfer
    let executor_balance_after = token.balance_of(EXECUTOR);
    let receiver_balance_after = token.balance_of(receiver_address);

    assert(executor_balance_after == executor_balance_before - value, 'Executor no decrease');
    assert(receiver_balance_after == receiver_balance_before + value, 'Receiver no increase');
}

#[test]
fn test_lz_receive_zero_value() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let value = 0_u256;

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Record initial balances
    let executor_balance_before = token.balance_of(EXECUTOR);
    let receiver_balance_before = token.balance_of(receiver_address);

    // Call lz_receive as executor with zero value
    cheat_caller_address_once(endpoint_address, EXECUTOR);
    let result = endpoint.lz_receive(origin.clone(), receiver_address, guid, message, "", value);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check balances remain unchanged
    let executor_balance_after = token.balance_of(EXECUTOR);
    let receiver_balance_after = token.balance_of(receiver_address);

    assert(executor_balance_after == executor_balance_before, 'Executor no change');
    assert(receiver_balance_after == receiver_balance_before, 'Receiver no change');
}

#[test]
fn test_lz_receive_value_exceeds_allowance() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let value = 2000_u256;
    let allowance = 1000_u256;

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Give executor insufficient allowance
    cheat_caller_address_once(token.contract_address, EXECUTOR);
    token.approve(endpoint_address, allowance);

    // Call lz_receive as executor
    cheat_caller_address_once(endpoint_address, EXECUTOR);
    let result = endpoint.lz_receive(origin, receiver_address, guid, message, "", value);

    // Should fail with value exceeds allowance error
    assert_panic_with_error(result, err_lz_receive_value_exceeds_allowance(value, allowance));
}

#[test]
fn test_lz_receive_exact_allowance_equals_value() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let value = 1000_u256;

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Give executor exact allowance
    cheat_caller_address_once(token.contract_address, EXECUTOR);
    token.approve(endpoint_address, value);

    // Record initial balances
    let executor_balance_before = token.balance_of(EXECUTOR);
    let receiver_balance_before = token.balance_of(receiver_address);

    // Call lz_receive as executor
    cheat_caller_address_once(endpoint_address, EXECUTOR);
    let result = endpoint.lz_receive(origin.clone(), receiver_address, guid, message, "", value);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check balances after transfer
    let executor_balance_after = token.balance_of(EXECUTOR);
    let receiver_balance_after = token.balance_of(receiver_address);

    assert(executor_balance_after == executor_balance_before - value, 'Executor no decrease');
    assert(receiver_balance_after == receiver_balance_before + value, 'Receiver no increase');

    // Check allowance is consumed
    let allowance_after = token.allowance(EXECUTOR, endpoint_address);
    assert(allowance_after == 0, 'Allowance should be consumed');
}

#[test]
fn test_lz_receive_large_value_transfer() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let value = 5000_u256; // Large value

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Give executor sufficient allowance
    cheat_caller_address_once(token.contract_address, EXECUTOR);
    token.approve(endpoint_address, value);

    // Record initial balances
    let executor_balance_before = token.balance_of(EXECUTOR);
    let receiver_balance_before = token.balance_of(receiver_address);

    // Call lz_receive as executor
    cheat_caller_address_once(endpoint_address, EXECUTOR);
    let result = endpoint.lz_receive(origin.clone(), receiver_address, guid, message, "", value);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check balances after transfer
    let executor_balance_after = token.balance_of(EXECUTOR);
    let receiver_balance_after = token.balance_of(receiver_address);

    assert(executor_balance_after == executor_balance_before - value, 'Executor no decrease');
    assert(receiver_balance_after == receiver_balance_before + value, 'Receiver no increase');
}

#[test]
fn test_lz_receive_multiple_transfers_different_values() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    // Test with different values
    let values = array![100_u256, 500_u256, 1000_u256];
    let mut total_transferred = 0_u256;

    let receiver_balance_initial = token.balance_of(receiver_address);

    for i in 0..values.len() {
        let value = *values.at(i);
        let nonce = (i + 1).into();
        let origin = create_test_origin_with_nonce(nonce);

        // Commit the message
        commit_message(
            endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
        );

        // Give executor allowance for this transfer
        cheat_caller_address_once(token.contract_address, EXECUTOR);
        token.approve(endpoint_address, value);

        // Call lz_receive as executor
        cheat_caller_address_once(endpoint_address, EXECUTOR);
        let result = endpoint
            .lz_receive(origin, receiver_address, guid, message.clone(), "", value);

        assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);
        total_transferred += value;
    }

    // Check final receiver balance
    let receiver_balance_final = token.balance_of(receiver_address);
    assert(
        receiver_balance_final == receiver_balance_initial + total_transferred,
        'Total transfer amount incorrect',
    );
}

#[test]
fn test_lz_receive_allowance_remains_after_smaller_transfer() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let value = 500_u256;
    let allowance = 1000_u256;

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Give executor more allowance than needed
    cheat_caller_address_once(token.contract_address, EXECUTOR);
    token.approve(endpoint_address, allowance);

    // Call lz_receive as executor
    cheat_caller_address_once(endpoint_address, EXECUTOR);
    let result = endpoint.lz_receive(origin.clone(), receiver_address, guid, message, "", value);
    assert(result.is_ok(), LZ_RECEIVE_SHOULD_SUCCEED);

    // Check remaining allowance
    let allowance_after = token.allowance(EXECUTOR, endpoint_address);
    assert(allowance_after == allowance - value, 'Allowance not reduced');
}

#[test]
#[fuzzer(runs: 10)]
fn lz_receive_fails_when_transfer_fails(value: u16) {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        token,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);
    let value = 1 + value.into(); // Ensure value is greater than 0
    let allowance = value;

    // Commit the message
    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    // Give executor more allowance than needed
    cheat_caller_address_once(token.contract_address, EXECUTOR);
    token.approve(endpoint_address, allowance);

    // Transfer fails
    start_mock_call(token.contract_address, selector!("transfer_from"), false);
    cheat_caller_address_once(endpoint_address, EXECUTOR);
    let result = endpoint.lz_receive(origin, receiver_address, guid, message, "", value);

    // Check lz_receive fails when transfer fails
    assert_panic_with_error(result, errors::err_native_transfer_failed());
}

/////////////////
// Clear tests //
/////////////////

#[test]
fn test_clear_as_oapp() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    let mut spy = spy_events();

    cheat_caller_address_once(endpoint_address, receiver_address);
    let _ = endpoint.clear(origin.clone(), receiver_address, guid, message);

    let delivered_event = EndpointV2::Event::PacketDelivered(
        PacketDelivered { origin, receiver: receiver_address },
    );
    spy.assert_emitted(@array![(endpoint_address, delivered_event)]);
}

#[test]
fn test_clear_as_delegate() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup_with_token();
    set_receive_library(
        endpoint_address, receiver_address, lib_address, SRC_EID, message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();
    let payload_hash = create_payload_hash(guid, @message);

    commit_message(
        endpoint, endpoint_address, lib_address, origin.clone(), receiver_address, payload_hash,
    );

    let mut spy = spy_events();

    cheat_caller_address_once(endpoint_address, receiver_address);
    let _ = endpoint.set_delegate(DELEGATE);

    cheat_caller_address_once(endpoint_address, DELEGATE);
    let _ = endpoint.clear(origin.clone(), receiver_address, guid, message);

    let delivered_event = EndpointV2::Event::PacketDelivered(
        PacketDelivered { origin, receiver: receiver_address },
    );
    spy.assert_emitted(@array![(endpoint_address, delivered_event)]);
}

#[test]
fn test_clear_fail_as_unauthorized() {
    let SetupResult { endpoint, endpoint_address, receiver_address, .. } = setup_with_token();

    let origin = create_test_prefix();
    let message = create_test_message();
    let guid = create_test_guid();

    cheat_caller_address_once(endpoint_address, DELEGATE);
    let result = endpoint.clear(origin, receiver_address, guid, message);

    assert_panic_with_error(result, err_unauthorized());
}
