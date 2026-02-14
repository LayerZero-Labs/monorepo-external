//! Test endpoint commit

use layerzero::common::constants::ETH_CONTRACT_ADDRESS;
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::endpoint_v2::EndpointV2;
use layerzero::endpoint::errors::{
    err_invalid_payload_hash, err_invalid_receive_library, err_path_not_initializable,
    err_path_not_verifiable,
};
use layerzero::endpoint::events::PacketVerified;
use layerzero::endpoint::interfaces::endpoint_v2::{
    IEndpointV2SafeDispatcher, IEndpointV2SafeDispatcherTrait,
};
use layerzero::endpoint::message_lib_manager::interface::{
    IMessageLibManagerDispatcher, IMessageLibManagerDispatcherTrait,
};
use layerzero::endpoint::messaging_channel::interface::{
    IMessagingChannelDispatcher, IMessagingChannelDispatcherTrait,
};
use layerzero::message_lib::structs::MessageLibType;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use openzeppelin::security::ReentrancyGuardComponent::Errors::REENTRANT_CALL;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::e2e::utils::deploy_blocked_message_lib;
use crate::mocks::receiver::MockReceiver::{
    IMockReceiverHelpersDispatcher, IMockReceiverHelpersDispatcherTrait,
};
use super::message_lib_manager::utils::deploy_erc20_mock;

// Test constants
pub const OWNER: ContractAddress = 'owner'.try_into().unwrap();
pub const SENDER: ContractAddress = 'sender'.try_into().unwrap();
pub const ANOTHER_SENDER: ContractAddress = 'another_sender'.try_into().unwrap();
pub const LIBRARY_ADDRESS: ContractAddress = 'library'.try_into().unwrap();
pub const NON_OWNER: ContractAddress = 'non_owner'.try_into().unwrap();
pub const MESSAGE_LIB: ContractAddress = 'msglib'.try_into().unwrap();
pub const EID: u32 = 1;
pub const SRC_EID: u32 = 2;

// Test assert message constants
pub const REGISTER_LIBRARY_FAILED: felt252 = 'registerLibrary failed';
pub const SET_RECEIVE_LIBRARY_FAILED: felt252 = 'setReceiveLibrary failed';
pub const COMMIT_SHOULD_SUCCEED: felt252 = 'Commit should succeed';
pub const COMMIT_SHOULD_FAIL: felt252 = 'Commit should fail';

struct DeployEndpointV2Result {
    endpoint: IEndpointV2SafeDispatcher,
    endpoint_address: ContractAddress,
}

fn deploy_endpoint() -> DeployEndpointV2Result {
    let blocked_library = deploy_blocked_message_lib();
    let contract = declare("EndpointV2").unwrap_syscall().contract_class();
    let constructor_calldata = array![
        OWNER.into(), EID.into(), ETH_CONTRACT_ADDRESS.into(), blocked_library.into(),
    ];
    let (contract_address, _) = contract.deploy(@constructor_calldata).unwrap_syscall();
    DeployEndpointV2Result {
        endpoint: IEndpointV2SafeDispatcher { contract_address },
        endpoint_address: contract_address,
    }
}

struct DeployReceiverResult {
    dispatcher: IMockReceiverHelpersDispatcher,
    receiver_address: ContractAddress,
}

fn deploy_mock_receiver() -> DeployReceiverResult {
    let contract = declare("MockReceiver").unwrap_syscall().contract_class();
    let (receiver_address, _) = contract.deploy(@array![]).unwrap_syscall();
    let mock_dispatcher = IMockReceiverHelpersDispatcher { contract_address: receiver_address };
    mock_dispatcher.set_allow_initialize(true);
    DeployReceiverResult { dispatcher: mock_dispatcher, receiver_address }
}

fn deploy_reentrant_receiver(endpoint: ContractAddress) -> ContractAddress {
    let contract = declare("MockReentrantReceiver").unwrap_syscall().contract_class();
    let (receiver_address, _) = contract.deploy(@array![endpoint.into()]).unwrap_syscall();
    receiver_address
}

fn deploy_simple_message_lib(endpoint: ContractAddress) -> ContractAddress {
    let contract = declare("SimpleMessageLib").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![endpoint.into()]).unwrap_syscall();
    address
}

fn register_library(
    endpoint_address: ContractAddress,
    message_lib_manager_dispatcher: IMessageLibManagerDispatcher,
    sml_address: ContractAddress,
) {
    start_cheat_caller_address(endpoint_address, OWNER);
    // Satisfy registration-time type check
    start_mock_call(sml_address, selector!("message_lib_type"), MessageLibType::SendAndReceive);
    let _result = message_lib_manager_dispatcher.register_library(sml_address);
    stop_cheat_caller_address(endpoint_address);
}

#[feature("safe_dispatcher")]
struct SetupResult {
    endpoint: IEndpointV2SafeDispatcher,
    endpoint_address: ContractAddress,
    sml_address: ContractAddress,
    receiver: IMockReceiverHelpersDispatcher,
    receiver_address: ContractAddress,
    message_lib_manager_dispatcher: IMessageLibManagerDispatcher,
}

#[feature("safe_dispatcher")]
fn setup() -> SetupResult {
    let DeployEndpointV2Result { endpoint, endpoint_address } = deploy_endpoint();
    let sml_address = deploy_simple_message_lib(endpoint_address);
    let message_lib_manager_dispatcher = IMessageLibManagerDispatcher {
        contract_address: endpoint_address,
    };
    register_library(endpoint_address, message_lib_manager_dispatcher, sml_address);
    // Register default send and receive libraries
    start_cheat_caller_address(endpoint_address, OWNER);
    message_lib_manager_dispatcher.set_default_send_library(EID, sml_address);
    message_lib_manager_dispatcher.set_default_receive_library(SRC_EID, sml_address, 0);
    stop_cheat_caller_address(endpoint_address);

    let DeployReceiverResult { dispatcher: receiver, receiver_address } = deploy_mock_receiver();

    SetupResult {
        endpoint,
        endpoint_address,
        sml_address,
        receiver,
        receiver_address,
        message_lib_manager_dispatcher,
    }
}

#[feature("safe_dispatcher")]
fn set_receive_library(
    endpoint: IEndpointV2SafeDispatcher,
    endpoint_address: ContractAddress,
    receiver: ContractAddress,
    lib_address: ContractAddress,
    src_eid: u32,
    message_lib_manager_dispatcher: IMessageLibManagerDispatcher,
) {
    start_cheat_caller_address(endpoint_address, receiver);
    // route through manager now
    message_lib_manager_dispatcher.set_receive_library(receiver, src_eid, lib_address, 0);
    stop_cheat_caller_address(endpoint_address);
}

fn create_test_prefix() -> Origin {
    Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 }
}

fn create_test_origin_with_clone() -> (Origin, Origin) {
    return (create_test_prefix(), create_test_prefix());
}

fn create_test_payload_hash() -> Bytes32 {
    Bytes32 { value: 0x123456789abcdef_u256 }
}

#[test]
#[should_panic]
fn test_deploy_endpoint_with_wrong_blocked_message_lib() {
    let wrong_blocked_library = deploy_erc20_mock();
    let contract = declare("EndpointV2").unwrap().contract_class();
    let constructor_calldata = array![
        OWNER.into(), EID.into(), ETH_CONTRACT_ADDRESS.into(), wrong_blocked_library.into(),
    ];
    contract.deploy(@constructor_calldata).unwrap();
}

#[test]
#[feature("safe_dispatcher")]
fn test_initializable_simple_true() {
    let SetupResult { endpoint, receiver_address, .. } = setup();
    let origin = create_test_prefix();
    assert(
        endpoint.initializable(origin, receiver_address).unwrap(), 'initializable should be true',
    );
}

#[test]
#[feature("safe_dispatcher")]
fn test_verifiable_simple_true() {
    let SetupResult { endpoint, receiver_address, .. } = setup();
    let origin = create_test_prefix();
    assert(endpoint.verifiable(origin, receiver_address).unwrap(), 'verifiable should be true');
}

#[test]
#[feature("safe_dispatcher")]
fn test_initializable_false_when_receiver_disallows_and_lazy_zero() {
    let SetupResult { endpoint, receiver, receiver_address, .. } = setup();
    // Disallow initialize and ensure lazy nonce is zero (default)
    receiver.set_allow_initialize(false);

    let origin = create_test_prefix();
    let is_initializable = endpoint.initializable(origin, receiver_address).unwrap();
    assert(!is_initializable, COMMIT_SHOULD_FAIL);
}

#[test]
#[feature("safe_dispatcher")]
fn test_initializable_true_when_lazy_nonce_gt_zero_even_if_receiver_disallows() {
    let SetupResult { endpoint, endpoint_address, receiver, receiver_address, .. } = setup();

    // Disallow initialize in the receiver
    receiver.set_allow_initialize(false);

    // Bump lazy inbound nonce via skip to make initializable return true
    let messaging_channel = IMessagingChannelDispatcher { contract_address: endpoint_address };
    start_cheat_caller_address(endpoint_address, receiver_address);
    messaging_channel
        .skip(receiver_address, Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 });
    stop_cheat_caller_address(endpoint_address);

    let origin = create_test_prefix();
    let is_initializable = endpoint.initializable(origin, receiver_address).unwrap();
    assert(is_initializable, COMMIT_SHOULD_SUCCEED);
}

#[test]
#[feature("safe_dispatcher")]
fn test_verifiable_false_when_nonce_leq_lazy_and_no_hash() {
    let SetupResult { endpoint, endpoint_address, receiver_address, .. } = setup();

    // Set lazy inbound nonce to 1 without committing any payload hash
    let messaging_channel = IMessagingChannelDispatcher { contract_address: endpoint_address };
    start_cheat_caller_address(endpoint_address, receiver_address);
    messaging_channel
        .skip(receiver_address, Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 });
    stop_cheat_caller_address(endpoint_address);

    // For nonce == 1 and lazy == 1, verifiable should be false if there is no stored hash
    let origin = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 };
    let is_verifiable = endpoint.verifiable(origin, receiver_address).unwrap();
    assert(!is_verifiable, COMMIT_SHOULD_FAIL);
}

#[test]
#[feature("safe_dispatcher")]
fn test_verifiable_true_when_payload_hash_exists_even_if_nonce_leq_lazy() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();

    // Ensure the receive library is configured for this receiver/path
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let origin = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 };
    let payload_hash = Bytes32 { value: 0xAAAA_u256 };

    // Commit nonce 1 from the configured library to store the payload hash
    start_cheat_caller_address(endpoint_address, lib_address);
    let _ = endpoint.verify(origin, receiver_address, payload_hash);
    stop_cheat_caller_address(endpoint_address);

    // Now bump lazy to 2 so that nonce 1 <= lazy
    let messaging_channel = IMessagingChannelDispatcher { contract_address: endpoint_address };
    start_cheat_caller_address(endpoint_address, receiver_address);
    messaging_channel
        .skip(receiver_address, Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 2 });
    stop_cheat_caller_address(endpoint_address);

    let origin_again = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 };
    let is_verifiable = endpoint.verifiable(origin_again, receiver_address).unwrap();
    assert(is_verifiable, COMMIT_SHOULD_SUCCEED);
}

#[test]
#[feature("safe_dispatcher")]
fn test_verifiable_false_after_burn() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();

    // Configure receive library
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let origin = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 };
    let payload_hash = Bytes32 { value: 0xBEEF_u256 };

    // Commit nonce 1
    start_cheat_caller_address(endpoint_address, lib_address);
    let _ = endpoint.verify(origin, receiver_address, payload_hash);
    stop_cheat_caller_address(endpoint_address);

    // Advance lazy to 2 so nonce 1 <= lazy
    let messaging_channel = IMessagingChannelDispatcher { contract_address: endpoint_address };
    start_cheat_caller_address(endpoint_address, receiver_address);
    messaging_channel
        .skip(receiver_address, Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 2 });

    // Burn the payload at nonce 1
    messaging_channel
        .burn(
            receiver_address,
            Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 },
            payload_hash,
        );
    stop_cheat_caller_address(endpoint_address);

    // Now verifiable should be false for nonce 1
    let origin_again = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 };
    let is_verifiable = endpoint.verifiable(origin_again, receiver_address).unwrap();
    assert(!is_verifiable, COMMIT_SHOULD_FAIL);
}

#[test]
#[feature("safe_dispatcher")]
fn test_verifiable_true_after_nilify() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();

    // Configure receive library
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let origin = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 };
    let payload_hash = Bytes32 { value: 0x1234_u256 };

    // Commit nonce 1
    start_cheat_caller_address(endpoint_address, lib_address);
    let _ = endpoint.verify(origin, receiver_address, payload_hash);
    stop_cheat_caller_address(endpoint_address);

    // Advance lazy to 2
    let messaging_channel = IMessagingChannelDispatcher { contract_address: endpoint_address };
    start_cheat_caller_address(endpoint_address, receiver_address);
    messaging_channel
        .skip(receiver_address, Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 2 });

    // Nilify nonce 1 (payload hash becomes NIL, still considered "has payload")
    messaging_channel
        .nilify(
            receiver_address,
            Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 },
            payload_hash,
        );
    stop_cheat_caller_address(endpoint_address);

    // Verifiable should be true because _has_payload_hash returns true for NIL
    let origin_again = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce: 1 };
    let is_verifiable = endpoint.verifiable(origin_again, receiver_address).unwrap();
    assert(is_verifiable, COMMIT_SHOULD_SUCCEED);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_success_with_configured_receive_library() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let (origin, origin_clone) = create_test_origin_with_clone();

    let payload_hash = create_test_payload_hash();

    // Call commit from the configured library
    start_cheat_caller_address(endpoint_address, lib_address);
    let mut spy = spy_events();
    let result = endpoint.verify(origin, receiver_address, payload_hash);
    assert(result.is_ok(), COMMIT_SHOULD_SUCCEED);

    // Check that PacketVerified event was emitted
    spy
        .assert_emitted(
            @array![
                (
                    endpoint_address,
                    EndpointV2::Event::PacketVerified(
                        PacketVerified {
                            origin: origin_clone,
                            receiver: receiver_address,
                            payload_hash: payload_hash,
                        },
                    ),
                ),
            ],
        );

    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_invalid_receive_library_unregistered() {
    let SetupResult { endpoint, receiver_address, .. } = setup();

    let origin = create_test_prefix();
    let payload_hash = create_test_payload_hash();

    // Call commit with no configured receive library
    let result = endpoint.verify(origin, receiver_address, payload_hash);
    assert_panic_with_error(result, err_invalid_receive_library());
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_invalid_receive_library_wrong_configured() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    // Deploy and register another library
    let other_lib = deploy_simple_message_lib(endpoint_address);
    register_library(endpoint_address, message_lib_manager_dispatcher, other_lib);

    let origin = create_test_prefix();
    let payload_hash = create_test_payload_hash();

    // Call commit from the other library (not the configured one)
    start_cheat_caller_address(endpoint_address, other_lib);
    let result = endpoint.verify(origin, receiver_address, payload_hash);
    assert_panic_with_error(result, err_invalid_receive_library());
    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_invalid_payload_hash_default() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let payload_hash = Default::default(); // Invalid - default/zero hash

    start_cheat_caller_address(endpoint_address, lib_address);
    let result = endpoint.verify(origin, receiver_address, payload_hash);
    assert_panic_with_error(result, err_invalid_payload_hash());
    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_path_not_initializable() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    receiver.set_allow_initialize(false);

    let origin = create_test_prefix();
    let payload_hash = create_test_payload_hash();

    start_cheat_caller_address(endpoint_address, lib_address);
    let result = endpoint.verify(origin, receiver_address, payload_hash);
    assert_panic_with_error(result, err_path_not_initializable());
    stop_cheat_caller_address(endpoint_address);
}


#[test]
#[feature("safe_dispatcher")]
fn test_commit_packet_not_verifiable() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let origin = create_test_prefix();
    let payload_hash = create_test_payload_hash();

    // Make the path non-verifiable by setting lazy nonce == origin.nonce without any stored hash
    let messaging_channel = IMessagingChannelDispatcher { contract_address: endpoint_address };
    start_cheat_caller_address(endpoint_address, receiver_address);
    messaging_channel.skip(receiver_address, origin.clone());
    stop_cheat_caller_address(endpoint_address);

    // Commit should now fail with not verifiable
    start_cheat_caller_address(endpoint_address, lib_address);
    let result = endpoint.verify(origin, receiver_address, payload_hash);
    assert_panic_with_error(result, err_path_not_verifiable());
    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_multiple_messages_same_path() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    start_cheat_caller_address(endpoint_address, lib_address);

    // Test multiple messages with different nonces on the same path
    let mut nonce = 1_u64;
    while nonce != 3 {
        let origin = Origin { src_eid: SRC_EID, sender: SENDER.into(), nonce };
        let payload_hash = Bytes32 { value: (0x111_u256 * nonce.into()) };

        let result = endpoint.verify(origin, receiver_address, payload_hash);
        assert(result.is_ok(), COMMIT_SHOULD_SUCCEED);

        nonce += 1;
    }

    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_different_senders_same_receiver() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let senders = array!['sender1', 'sender2', 'sender3'];

    start_cheat_caller_address(endpoint_address, lib_address);

    for i in 0..senders.len() {
        let sender: ContractAddress = (*senders.at(i)).try_into().unwrap();
        let origin = Origin { src_eid: SRC_EID, sender: sender.into(), nonce: 1 };
        let payload_hash = Bytes32 { value: (0x111_u256 * (i + 1).into()) };

        let result = endpoint.verify(origin, receiver_address, payload_hash);
        assert(result.is_ok(), COMMIT_SHOULD_SUCCEED);
    }

    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_different_source_eids() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();

    let src_eids = array![101_u32, 102_u32, 103_u32];

    // Set receive library for each source EID
    for src_eid in @src_eids {
        set_receive_library(
            endpoint,
            endpoint_address,
            receiver_address,
            lib_address,
            *src_eid,
            message_lib_manager_dispatcher,
        );
    }

    start_cheat_caller_address(endpoint_address, lib_address);

    // Commit from each source EID
    for i in 0..(src_eids.len() - 1) {
        let src_eid = *src_eids.at(i);
        let origin = Origin { src_eid, sender: SENDER.into(), nonce: 1 };
        let payload_hash = Bytes32 { value: (0x111_u256 * (i + 1).into()) };

        let result = endpoint.verify(origin, receiver_address, payload_hash);
        assert(result.is_ok(), COMMIT_SHOULD_SUCCEED);
    }

    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_different_receivers() {
    let SetupResult {
        endpoint, endpoint_address, sml_address: lib_address, message_lib_manager_dispatcher, ..,
    } = setup();

    // Deploy multiple receivers
    let mut receivers = array![];
    for _ in 0_u8..3 {
        let DeployReceiverResult { receiver_address, .. } = deploy_mock_receiver();
        set_receive_library(
            endpoint,
            endpoint_address,
            receiver_address,
            lib_address,
            SRC_EID,
            message_lib_manager_dispatcher,
        );
        receivers.append(receiver_address);
    }

    let origin = create_test_prefix();

    start_cheat_caller_address(endpoint_address, lib_address);

    // Commit to each receiver
    for i in 0..receivers.len() {
        let receiver_address = *receivers.at(i);
        let payload_hash = Bytes32 { value: (0x111_u256 * (i + 1).into()) };

        let result = endpoint.verify(origin.clone(), receiver_address, payload_hash);
        assert(result.is_ok(), COMMIT_SHOULD_SUCCEED);
    }

    stop_cheat_caller_address(endpoint_address);
}

#[test]
#[feature("safe_dispatcher")]
fn test_commit_overwrites_payload_hash() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address: lib_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();
    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        lib_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let (origin, origin_clone) = create_test_origin_with_clone();
    let payload_hash1 = Bytes32 { value: 0x111_u256 };
    let payload_hash2 = Bytes32 { value: 0x222_u256 };

    start_cheat_caller_address(endpoint_address, lib_address);

    // Commit first payload hash
    let _result1 = endpoint.verify(origin, receiver_address, payload_hash1);
    assert(_result1.is_ok(), COMMIT_SHOULD_SUCCEED);
    // Commit second payload hash for same origin/receiver (should overwrite)
    let _result2 = endpoint.verify(origin_clone, receiver_address, payload_hash2);
    assert(_result2.is_ok(), COMMIT_SHOULD_SUCCEED);

    stop_cheat_caller_address(endpoint_address);
}


#[test]
#[feature("safe_dispatcher")]
fn test_commit_reentrant() {
    let SetupResult {
        endpoint,
        endpoint_address,
        sml_address,
        receiver_address,
        message_lib_manager_dispatcher,
        ..,
    } = setup();

    set_receive_library(
        endpoint,
        endpoint_address,
        receiver_address,
        sml_address,
        SRC_EID,
        message_lib_manager_dispatcher,
    );

    let (origin, _) = create_test_origin_with_clone();
    let payload_hash = Bytes32 { value: 0x111 };
    let reentrant_receiver_address = deploy_reentrant_receiver(endpoint_address);

    cheat_caller_address_once(endpoint_address, sml_address);
    let result = endpoint.verify(origin, reentrant_receiver_address, payload_hash);
    assert_panic_with_felt_error(result, REENTRANT_CALL);
}
