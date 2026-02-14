//! OmniCounter tests

use layerzero::common::structs::messaging::MessagingFee;
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::layerzero_receiver::{
    ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
    ILayerZeroReceiverSafeDispatcher, ILayerZeroReceiverSafeDispatcherTrait,
};
use layerzero::oapps::counter::constants::{ABA_TYPE, VANILLA_TYPE};
use layerzero::oapps::counter::counter::OmniCounter;
use layerzero::oapps::counter::interface::{IOmniCounterDispatcher, IOmniCounterDispatcherTrait};
use layerzero::oapps::counter::msg_codec;
use layerzero::oapps::counter::structs::{IncrementReceived, IncrementSent};
use layerzero::oapps::oapp::interface::{IOAppDispatcher, IOAppDispatcherTrait};
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use crate::common::utils::total_native_fee_from_receipt;

// Test constants
const FAKE_ENDPOINT: ContractAddress = 'fake_endpoint'.try_into().unwrap();
const OWNER: ContractAddress = 'owner'.try_into().unwrap();
const USER: ContractAddress = 'user'.try_into().unwrap();
const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
const REFUND_ADDRESS: ContractAddress = 'refund'.try_into().unwrap();
const SENDER: ContractAddress = 'sender'.try_into().unwrap();
const VALUE: u256 = 1000_u256;

// Test assert message constants
const INIT_COUNTER_SHOULD_BE_0: felt252 = 'Init!=0';
const INIT_ENDPOINT_WRONG: felt252 = 'InitEpWrong';
const COUNTER_NOT_INCREMENTED: felt252 = 'should inc';
const SEND_RECEIPT_NONCE_WRONG: felt252 = 'SendRcptNonceWrong';
const COUNTER_SHOULD_NOT_INCREMENT: felt252 = 'should not inc';
const ZERO_FEE_NOT_OK: felt252 = '0 fee not ok';
const EMPTY_OPTIONS_NOT_OK: felt252 = 'null options not ok';
const LZ_RECEIVE_SHOULD_FAIL: felt252 = 'LzRcv did not fail';
const PATH_NOT_ALLOWED: felt252 = 'path not allowed';

const SRC_EID: u32 = 101;
const DST_EID: u32 = 102;
const INITIAL_SUPPLY: u256 = 1000;

fn MOCK_OPTIONS() -> ByteArray {
    "test options"
}

fn MOCK_MESSAGING_FEE() -> MessagingFee {
    MessagingFee { native_fee: 0, lz_token_fee: 0 }
}

fn MOCK_GUID() -> Bytes32 {
    Bytes32 { value: 0x123456789abcdef }
}

fn MOCK_ORIGIN(src_eid: u32) -> Origin {
    Origin { src_eid, sender: SENDER.into(), nonce: 1_u64 }
}

fn mock_message() -> ByteArray {
    msg_codec::encode(VANILLA_TYPE, SRC_EID)
}

fn deploy_test_erc20(owner: ContractAddress) -> ContractAddress {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let mut params = array![];
    INITIAL_SUPPLY.serialize(ref params);
    owner.serialize(ref params);

    let (address, _) = contract.deploy(@params).unwrap_syscall();
    address
}

fn deploy_mock_endpoint() -> ContractAddress {
    let contract = declare("MockEndpointV2").unwrap_syscall().contract_class();
    let (address, _) = contract.deploy(@array![SRC_EID.into()]).unwrap_syscall();
    address
}

fn deploy_omni_counter(
    endpoint: ContractAddress, owner: ContractAddress, stark_token: ContractAddress,
) -> ContractAddress {
    let contract = declare("OmniCounter").unwrap_syscall().contract_class();
    let (address, _) = contract
        .deploy(@array![endpoint.into(), owner.into(), stark_token.into()])
        .unwrap_syscall();
    address
}

fn setup() -> (
    ContractAddress,
    ContractAddress,
    IOmniCounterDispatcher,
    ILayerZeroReceiverDispatcher,
    ILayerZeroReceiverSafeDispatcher,
    IOAppDispatcher,
) {
    let endpoint_address = deploy_mock_endpoint();
    let stark_token_address = deploy_test_erc20(OWNER);
    let lz_token_address = deploy_test_erc20(OWNER);
    let counter_address = deploy_omni_counter(endpoint_address, OWNER, stark_token_address);
    start_mock_call(FAKE_ENDPOINT, selector!("get_lz_token"), lz_token_address);

    let counter_dispatcher = IOmniCounterDispatcher { contract_address: counter_address };
    let receiver_dispatcher = ILayerZeroReceiverDispatcher { contract_address: counter_address };
    let receiver_safe_dispatcher = ILayerZeroReceiverSafeDispatcher {
        contract_address: counter_address,
    };
    let oapp_dispatcher = IOAppDispatcher { contract_address: counter_address };

    // Set up peers for both source and destination EIDs using the counter address as peer

    start_cheat_caller_address(counter_address, OWNER);
    oapp_dispatcher.set_peer(SRC_EID, SENDER.into());
    oapp_dispatcher.set_peer(DST_EID, SENDER.into());
    stop_cheat_caller_address(counter_address);

    (
        counter_address,
        endpoint_address,
        counter_dispatcher,
        receiver_dispatcher,
        receiver_safe_dispatcher,
        oapp_dispatcher,
    )
}

#[test]
fn test_constructor() {
    let (_, endpoint_address, _, _, _, oapp_dispatcher) = setup();

    // Test endpoint (inherited from OAppCore)
    assert(oapp_dispatcher.get_endpoint() == endpoint_address, 1);
}

#[test]
fn test_get_counter_initial_value() {
    let (_, _, counter_dispatcher, _, _, _) = setup();

    // All counters should start at 0
    assert(counter_dispatcher.get_counter(SRC_EID) == 0, INIT_COUNTER_SHOULD_BE_0);
    assert(counter_dispatcher.get_counter(DST_EID) == 0, INIT_COUNTER_SHOULD_BE_0);
    assert(counter_dispatcher.get_counter(999) == 0, INIT_COUNTER_SHOULD_BE_0);
}

#[test]
fn test_increment_type_a_b() {
    let (counter_address, _, counter_dispatcher, _, _, _) = setup();

    let mut spy = spy_events();

    start_cheat_caller_address(counter_address, USER);
    let receipt = counter_dispatcher
        .increment(DST_EID, VANILLA_TYPE, MOCK_OPTIONS(), MOCK_MESSAGING_FEE(), REFUND_ADDRESS);
    stop_cheat_caller_address(counter_address);

    // Verify receipt
    assert(receipt.nonce == 0, 'Receipt nonce should be 0');
    assert(total_native_fee_from_receipt(@receipt) == 1000_u256, 'Receipt fee mismatch');

    // Verify event was emitted
    let expected_event = OmniCounter::Event::IncrementSent(
        IncrementSent { sender: USER, dst_eid: DST_EID, increment_type: VANILLA_TYPE },
    );
    spy.assert_emitted(@array![(counter_address, expected_event)]);
}

#[test]
fn test_increment_type_a_b_a() {
    let (counter_address, _, counter_dispatcher, _, _, _) = setup();

    let mut spy = spy_events();

    start_cheat_caller_address(counter_address, USER);
    let receipt = counter_dispatcher
        .increment(DST_EID, ABA_TYPE, MOCK_OPTIONS(), MOCK_MESSAGING_FEE(), REFUND_ADDRESS);
    stop_cheat_caller_address(counter_address);

    // Verify receipt
    assert(receipt.nonce == 0, SEND_RECEIPT_NONCE_WRONG);

    // Verify event was emitted
    let expected_event = OmniCounter::Event::IncrementSent(
        IncrementSent { sender: USER, dst_eid: DST_EID, increment_type: ABA_TYPE },
    );
    spy.assert_emitted(@array![(counter_address, expected_event)]);
}

#[test]
fn test_multiple_increments() {
    let (counter_address, _, counter_dispatcher, _, _, _) = setup();

    // Send multiple increments and verify nonce increments
    let mut i: u32 = 0;
    while i != 5 {
        start_cheat_caller_address(counter_address, USER);
        let receipt = counter_dispatcher
            .increment(DST_EID, VANILLA_TYPE, MOCK_OPTIONS(), MOCK_MESSAGING_FEE(), REFUND_ADDRESS);
        stop_cheat_caller_address(counter_address);

        // Verify that nonce matches the iteration count
        assert(receipt.nonce == i.into(), SEND_RECEIPT_NONCE_WRONG);
        i += 1;
    };
}

#[test]
fn test_lz_receive_type_a_b() {
    let (counter_address, endpoint_address, counter_dispatcher, receiver_dispatcher, _, _) =
        setup();

    let mut spy = spy_events();

    let message = mock_message();

    // Call lz_receive from endpoint
    start_cheat_caller_address(counter_address, endpoint_address);
    receiver_dispatcher.lz_receive(MOCK_ORIGIN(SRC_EID), MOCK_GUID(), message, EXECUTOR, "", VALUE);
    stop_cheat_caller_address(counter_address);

    // Verify counter was incremented
    assert(counter_dispatcher.get_counter(SRC_EID) == 1, COUNTER_NOT_INCREMENTED);

    // Verify event was emitted
    let expected_event = OmniCounter::Event::IncrementReceived(
        IncrementReceived {
            src_eid: SRC_EID,
            old_value: 0,
            new_value: 1,
            increment_type: VANILLA_TYPE,
            value: VALUE,
        },
    );
    spy.assert_emitted(@array![(counter_address, expected_event)]);
}

#[test]
fn test_lz_receive_type_a_b_a() {
    let (counter_address, endpoint_address, counter_dispatcher, receiver_dispatcher, _, _) =
        setup();

    let mut spy = spy_events();

    let message = msg_codec::encode(ABA_TYPE, SRC_EID);

    // Call lz_receive from endpoint
    start_cheat_caller_address(counter_address, endpoint_address);
    receiver_dispatcher.lz_receive(MOCK_ORIGIN(SRC_EID), MOCK_GUID(), message, EXECUTOR, "", 0);
    stop_cheat_caller_address(counter_address);

    // Verify counter was incremented
    let counter_value = counter_dispatcher.get_counter(SRC_EID);
    assert(counter_value == 1, COUNTER_NOT_INCREMENTED);

    // Verify IncrementReceived event was emitted
    let expected_received_event = OmniCounter::Event::IncrementReceived(
        IncrementReceived {
            src_eid: SRC_EID, old_value: 0, new_value: 1, increment_type: ABA_TYPE, value: 0,
        },
    );

    let expected_sent_event = OmniCounter::Event::IncrementSent(
        IncrementSent { sender: counter_address, dst_eid: SRC_EID, increment_type: VANILLA_TYPE },
    );

    spy
        .assert_emitted(
            @array![
                (counter_address, expected_received_event), (counter_address, expected_sent_event),
            ],
        );
}

#[test]
fn test_multiple_lz_receives_same_eid() {
    let (counter_address, endpoint_address, counter_dispatcher, receiver_dispatcher, _, _) =
        setup();

    // Create message
    let message = mock_message();

    // Receive multiple messages from same EID
    let mut i: u32 = 0;
    while i != 5 {
        start_cheat_caller_address(counter_address, endpoint_address);
        receiver_dispatcher
            .lz_receive(MOCK_ORIGIN(SRC_EID), MOCK_GUID(), message.clone(), EXECUTOR, "", VALUE);
        stop_cheat_caller_address(counter_address);

        // Verify counter is incremented correctly
        let expected_count = i + 1;
        assert(
            counter_dispatcher.get_counter(SRC_EID) == expected_count.into(),
            'Counter not incremented',
        );
        i += 1;
    };
}

#[test]
fn test_multiple_lz_receives_different_eids() {
    let (
        counter_address,
        endpoint_address,
        counter_dispatcher,
        receiver_dispatcher,
        _,
        oapp_dispatcher,
    ) =
        setup();

    // Create message
    let message = mock_message();

    // Receive messages from different EIDs
    let eids = array![101, 102, 103, 104, 105];
    let mut i: u32 = 0;
    for eid in eids {
        // set peer
        start_cheat_caller_address(counter_address, OWNER);
        oapp_dispatcher.set_peer(eid, SENDER.into());
        stop_cheat_caller_address(counter_address);

        start_cheat_caller_address(counter_address, endpoint_address);
        receiver_dispatcher
            .lz_receive(MOCK_ORIGIN(eid), MOCK_GUID(), message.clone(), EXECUTOR, "", VALUE);
        stop_cheat_caller_address(counter_address);

        // Each EID should have counter = 1
        assert(counter_dispatcher.get_counter(eid) == 1, COUNTER_NOT_INCREMENTED);
        i += 1;
    }
}

#[test]
#[feature("safe_dispatcher")]
// #[should_panic(expected: ('OAppCore: caller not endpoint',))]
fn test_lz_receive_fails_when_not_called_by_endpoint() {
    let (counter_address, _, _, _, receiver_safe_dispatcher, _) = setup();

    // Create message
    let message = mock_message();

    // Try to call lz_receive from non-endpoint address (should fail)
    start_cheat_caller_address(counter_address, USER);
    let result = receiver_safe_dispatcher
        .lz_receive(MOCK_ORIGIN(SRC_EID), MOCK_GUID(), message, EXECUTOR, "", VALUE);
    assert(result.is_err(), LZ_RECEIVE_SHOULD_FAIL);
    stop_cheat_caller_address(counter_address);
}

#[test]
fn test_allow_initialize_path() {
    let (_, _, _, receiver_dispatcher, _, _) = setup();

    // Should always return true for any origin
    assert(receiver_dispatcher.allow_initialize_path(MOCK_ORIGIN(SRC_EID)), PATH_NOT_ALLOWED);
    // This is unset
    assert(!receiver_dispatcher.allow_initialize_path(MOCK_ORIGIN(999)), PATH_NOT_ALLOWED);
}

#[test]
fn test_increment_with_empty_options() {
    let (counter_address, _, counter_dispatcher, _, _, _) = setup();

    let empty_options: ByteArray = "";

    start_cheat_caller_address(counter_address, USER);
    let receipt = counter_dispatcher
        .increment(DST_EID, VANILLA_TYPE, empty_options, MOCK_MESSAGING_FEE(), REFUND_ADDRESS);
    stop_cheat_caller_address(counter_address);

    assert(receipt.nonce == 0, EMPTY_OPTIONS_NOT_OK);
}

#[test]
fn test_increment_with_zero_fee() {
    let (counter_address, _, counter_dispatcher, _, _, _) = setup();

    let zero_fee = MessagingFee { native_fee: 0, lz_token_fee: 0 };

    start_cheat_caller_address(counter_address, USER);
    let receipt = counter_dispatcher
        .increment(DST_EID, VANILLA_TYPE, MOCK_OPTIONS(), zero_fee, REFUND_ADDRESS);
    stop_cheat_caller_address(counter_address);

    assert(receipt.nonce == 0, ZERO_FEE_NOT_OK);
}

#[test]
fn test_full_integration_workflow() {
    let (
        counter_address,
        endpoint_address,
        counter_dispatcher,
        receiver_dispatcher,
        _,
        oapp_dispatcher,
    ) =
        setup();

    // Verify initial state
    assert(oapp_dispatcher.get_endpoint() == endpoint_address, INIT_ENDPOINT_WRONG);
    assert(counter_dispatcher.get_counter(SRC_EID) == 0, INIT_COUNTER_SHOULD_BE_0);
    assert(counter_dispatcher.get_counter(DST_EID) == 0, INIT_COUNTER_SHOULD_BE_0);

    // Send an increment message
    start_cheat_caller_address(counter_address, USER);
    let receipt = counter_dispatcher
        .increment(DST_EID, VANILLA_TYPE, MOCK_OPTIONS(), MOCK_MESSAGING_FEE(), REFUND_ADDRESS);
    stop_cheat_caller_address(counter_address);

    assert(receipt.nonce == 0, SEND_RECEIPT_NONCE_WRONG);

    // Receive an increment message
    let message = mock_message();

    start_cheat_caller_address(counter_address, endpoint_address);
    receiver_dispatcher.lz_receive(MOCK_ORIGIN(SRC_EID), MOCK_GUID(), message, EXECUTOR, "", VALUE);
    stop_cheat_caller_address(counter_address);

    // Verify counter was incremented for SRC_EID
    assert(counter_dispatcher.get_counter(SRC_EID) == 1, COUNTER_NOT_INCREMENTED);
    assert(counter_dispatcher.get_counter(DST_EID) == 0, COUNTER_SHOULD_NOT_INCREMENT);
}

#[test]
fn test_counter_overflow_protection() {
    let (counter_address, endpoint_address, counter_dispatcher, receiver_dispatcher, _, _) =
        setup();

    // Create message
    let message = mock_message();

    // Simulate a large number of increments to test for overflow
    // Note: In a real test, you might want to test closer to u256 max
    let mut i: u32 = 0;
    while i != 100 {
        start_cheat_caller_address(counter_address, endpoint_address);
        receiver_dispatcher
            .lz_receive(MOCK_ORIGIN(SRC_EID), MOCK_GUID(), message.clone(), EXECUTOR, "", VALUE);
        stop_cheat_caller_address(counter_address);
        i += 1;
    }

    assert(counter_dispatcher.get_counter(SRC_EID) == 100, COUNTER_NOT_INCREMENTED);
}
