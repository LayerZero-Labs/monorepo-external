//! OApp core tests

use core::num::traits::Pow;
use layerzero::common::structs::packet::Origin;
use layerzero::endpoint::interfaces::endpoint_v2::IEndpointV2DispatcherTrait;
use layerzero::endpoint::interfaces::layerzero_receiver::{
    ILayerZeroReceiverDispatcher, ILayerZeroReceiverDispatcherTrait,
    ILayerZeroReceiverSafeDispatcher, ILayerZeroReceiverSafeDispatcherTrait,
};
use layerzero::oapps::oapp::errors::{
    err_approval_failed, err_invalid_delegate, err_lz_token_unavailable, err_no_peer,
    err_not_enough_lz_token, err_not_enough_lz_token_allowance, err_not_enough_native,
    err_not_enough_native_allowance, err_only_endpoint, err_only_peer, err_transfer_failed,
};
use layerzero::oapps::oapp::events::PeerSet;
use layerzero::oapps::oapp::interface::{
    IOAppDispatcher, IOAppDispatcherTrait, IOAppReceiverDispatcher, IOAppReceiverDispatcherTrait,
    IOAppSafeDispatcher, IOAppSafeDispatcherTrait,
};
use layerzero::oapps::oapp::oapp_core::OAppCoreComponent;
use layerzero::{MessageReceipt, MessagingFee};
use lz_utils::bytes::Bytes32;
use openzeppelin::access::ownable::OwnableComponent;
use openzeppelin::access::ownable::interface::{
    IOwnableDispatcher, IOwnableDispatcherTrait, IOwnableSafeDispatcher,
};
use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, EventSpyAssertionsTrait, declare, mock_call, spy_events,
    start_cheat_caller_address, start_mock_call, stop_cheat_caller_address,
};
use starknet::{ContractAddress, SyscallResultTrait};
use starkware_utils_testing::test_utils::{
    assert_panic_with_error, assert_panic_with_felt_error, cheat_caller_address_once,
};
use crate::constants::assert_eq;
use crate::endpoint::utils::deploy_endpoint;
use crate::mocks::oapp_core::interface::{
    IMockOAppCoreDispatcher, IMockOAppCoreDispatcherTrait, IMockOAppCoreSafeDispatcher,
    IMockOAppCoreSafeDispatcherTrait,
};
use crate::mocks::oapp_core::oapp_core::MockOAppCore;

// Test constants
const FAKE_ENDPOINT: ContractAddress = 'fake_endpoint'.try_into().unwrap();
const OWNER: ContractAddress = 'owner'.try_into().unwrap();
const NON_OWNER: ContractAddress = 'non_owner'.try_into().unwrap();
const USER: ContractAddress = 'user'.try_into().unwrap();
const EXECUTOR: ContractAddress = 'executor'.try_into().unwrap();
const ZERO_ADDRESS: ContractAddress = 0.try_into().unwrap();
const EID_1: u32 = 101;
const EID_2: u32 = 102;
const SRC_EID: u32 = 201;
const UNKNOWN_EID: u32 = 999;
const INITIAL_SUPPLY: u256 = 10_u256.pow(10);

fn MOCK_PEER_1() -> Bytes32 {
    Bytes32 { value: 0x123456789abcdef }
}

fn MOCK_PEER_2() -> Bytes32 {
    Bytes32 { value: 0xfedcba987654321 }
}

fn ZERO_PEER() -> Bytes32 {
    Bytes32 { value: 0 }
}

fn MOCK_GUID() -> Bytes32 {
    Bytes32 { value: 0xabcdef123456789 }
}

fn MOCK_MESSAGE() -> ByteArray {
    "test message"
}

fn MOCK_ORIGIN() -> Origin {
    Origin { src_eid: SRC_EID, sender: MOCK_PEER_1(), nonce: 1 }
}

#[derive(Drop, Copy)]
struct TestSetup {
    oapp_address: ContractAddress,
    oapp_dispatcher: IOAppDispatcher,
    ownable_dispatcher: IOwnableDispatcher,
    lz_receiver_dispatcher: ILayerZeroReceiverDispatcher,
    oapp_receiver_dispatcher: IOAppReceiverDispatcher,
    oapp_safe_dispatcher: IOAppSafeDispatcher,
    ownable_safe_dispatcher: IOwnableSafeDispatcher,
    lz_receiver_safe_dispatcher: ILayerZeroReceiverSafeDispatcher,
    mock_oapp_core_dispatcher: IMockOAppCoreDispatcher,
    mock_oapp_core_safe_dispatcher: IMockOAppCoreSafeDispatcher,
    stark_token_dispatcher: IERC20Dispatcher,
    lz_token_dispatcher: IERC20Dispatcher,
}


fn deploy_test_erc20(owner: ContractAddress) -> ContractAddress {
    let contract = declare("MockERC20").unwrap_syscall().contract_class();
    let mut params = array![];
    INITIAL_SUPPLY.serialize(ref params);
    owner.serialize(ref params);

    let (address, _) = contract.deploy(@params).unwrap_syscall();
    address
}

fn deploy_test_oapp_core(
    endpoint: ContractAddress, owner: ContractAddress, stark_token: ContractAddress,
) -> ContractAddress {
    let contract = declare("MockOAppCore").unwrap_syscall().contract_class();

    let (address, _) = contract
        .deploy(@array![endpoint.into(), owner.into(), stark_token.into()])
        .unwrap_syscall();
    address
}

fn setup() -> TestSetup {
    let stark_token = deploy_test_erc20(OWNER);
    let lz_token = deploy_test_erc20(OWNER);
    mock_call(FAKE_ENDPOINT, selector!("set_delegate"), (), 1);
    let oapp_address = deploy_test_oapp_core(FAKE_ENDPOINT, OWNER, stark_token);
    start_mock_call(FAKE_ENDPOINT, selector!("get_lz_token"), lz_token);

    let oapp_dispatcher = IOAppDispatcher { contract_address: oapp_address };
    let ownable_dispatcher = IOwnableDispatcher { contract_address: oapp_address };
    let lz_receiver_dispatcher = ILayerZeroReceiverDispatcher { contract_address: oapp_address };
    let oapp_receiver_dispatcher = IOAppReceiverDispatcher { contract_address: oapp_address };
    let oapp_safe_dispatcher = IOAppSafeDispatcher { contract_address: oapp_address };
    let ownable_safe_dispatcher = IOwnableSafeDispatcher { contract_address: oapp_address };
    let lz_receiver_safe_dispatcher = ILayerZeroReceiverSafeDispatcher {
        contract_address: oapp_address,
    };
    let mock_oapp_core_dispatcher = IMockOAppCoreDispatcher { contract_address: oapp_address };
    let mock_oapp_core_safe_dispatcher = IMockOAppCoreSafeDispatcher {
        contract_address: oapp_address,
    };
    let stark_token_dispatcher = IERC20Dispatcher { contract_address: stark_token };
    let lz_token_dispatcher = IERC20Dispatcher { contract_address: lz_token };
    // Set up peer for testing
    start_cheat_caller_address(oapp_address, OWNER);
    oapp_dispatcher.set_peer(SRC_EID, MOCK_PEER_1());
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());
    stop_cheat_caller_address(oapp_address);

    TestSetup {
        oapp_address,
        oapp_dispatcher,
        ownable_dispatcher,
        lz_receiver_dispatcher,
        oapp_receiver_dispatcher,
        oapp_safe_dispatcher,
        ownable_safe_dispatcher,
        lz_receiver_safe_dispatcher,
        mock_oapp_core_dispatcher,
        mock_oapp_core_safe_dispatcher,
        stark_token_dispatcher,
        lz_token_dispatcher,
    }
}

// =============================== Test Constructor =================================

#[test]
fn test_constructor() {
    let TestSetup { oapp_dispatcher, ownable_dispatcher, .. } = setup();

    assert_eq(oapp_dispatcher.get_endpoint(), FAKE_ENDPOINT);
    assert_eq(ownable_dispatcher.owner(), OWNER);
}

#[test]
fn test_set_delegate_on_construction() {
    let oapp_owner = 'my_oapp_owner'.try_into().unwrap();

    let native_token = deploy_test_erc20(OWNER);
    let endpoint = deploy_endpoint(OWNER, 0);
    let oapp = deploy_test_oapp_core(endpoint.endpoint, oapp_owner, native_token);

    assert_eq(endpoint.dispatcher.get_delegate(oapp), oapp_owner);
}

#[test]
fn test_set_delegate_on_construction_with_zero_address() {
    let native_token = deploy_test_erc20(OWNER);
    let endpoint = deploy_endpoint(OWNER, 0);
    let contract = declare("MockOAppCore").unwrap_syscall().contract_class();

    let result = contract
        .deploy(@array![endpoint.endpoint.into(), ZERO_ADDRESS.into(), native_token.into()]);

    assert_panic_with_error(result, err_invalid_delegate());
}

// =============================== Test OApp Version =================================

#[test]
fn test_oapp_version() {
    let TestSetup { oapp_dispatcher, .. } = setup();
    let (sender_version, receiver_version) = oapp_dispatcher.oapp_version();
    assert_eq(sender_version, 1);
    assert_eq(receiver_version, 1);
}

// =============================== Test Set Peer =================================

#[test]
fn test_set_peer_as_owner() {
    let TestSetup { oapp_address, oapp_dispatcher, .. } = setup();
    let mut spy = spy_events();

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());
    assert_eq(oapp_dispatcher.get_peer(EID_1), MOCK_PEER_1());

    let expected_event = MockOAppCore::Event::OAppCoreEvent(
        OAppCoreComponent::Event::PeerSet(PeerSet { eid: EID_1, peer: MOCK_PEER_1() }),
    );
    spy.assert_emitted(@array![(oapp_address, expected_event)]);
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_peer_fails_as_non_owner() {
    let TestSetup { oapp_address, oapp_safe_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, NON_OWNER);
    let result = oapp_safe_dispatcher.set_peer(EID_1, MOCK_PEER_1());

    assert_panic_with_felt_error(result, OwnableComponent::Errors::NOT_OWNER);
}

// =============================== Test Get Peer =================================

#[test]
fn test_get_unset_peer() {
    let TestSetup { oapp_dispatcher, .. } = setup();
    assert_eq(oapp_dispatcher.get_peer(UNKNOWN_EID), ZERO_PEER());
}

#[test]
fn test_get_set_peer() {
    let TestSetup { oapp_address, oapp_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_2, MOCK_PEER_2());
    assert_eq(oapp_dispatcher.get_peer(EID_2), MOCK_PEER_2());
}

// =============================== Test Multiple Peers =================================

#[test]
fn test_set_multiple_peers() {
    let TestSetup { oapp_address, oapp_dispatcher, .. } = setup();
    let mut spy = spy_events();

    start_cheat_caller_address(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());
    oapp_dispatcher.set_peer(EID_2, MOCK_PEER_2());
    stop_cheat_caller_address(oapp_address);

    assert_eq(oapp_dispatcher.get_peer(EID_1), MOCK_PEER_1());
    assert_eq(oapp_dispatcher.get_peer(EID_2), MOCK_PEER_2());

    let expected_event_1 = MockOAppCore::Event::OAppCoreEvent(
        OAppCoreComponent::Event::PeerSet(PeerSet { eid: EID_1, peer: MOCK_PEER_1() }),
    );
    let expected_event_2 = MockOAppCore::Event::OAppCoreEvent(
        OAppCoreComponent::Event::PeerSet(PeerSet { eid: EID_2, peer: MOCK_PEER_2() }),
    );
    spy.assert_emitted(@array![(oapp_address, expected_event_1), (oapp_address, expected_event_2)]);
}

// =============================== Test Update Peer =================================

#[test]
fn test_update_peer() {
    let TestSetup { oapp_address, oapp_dispatcher, .. } = setup();
    let mut spy = spy_events();

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());
    assert_eq(oapp_dispatcher.get_peer(EID_1), MOCK_PEER_1());

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_2());
    assert_eq(oapp_dispatcher.get_peer(EID_1), MOCK_PEER_2());

    let expected_event_1 = MockOAppCore::Event::OAppCoreEvent(
        OAppCoreComponent::Event::PeerSet(PeerSet { eid: EID_1, peer: MOCK_PEER_1() }),
    );
    let expected_event_2 = MockOAppCore::Event::OAppCoreEvent(
        OAppCoreComponent::Event::PeerSet(PeerSet { eid: EID_1, peer: MOCK_PEER_2() }),
    );
    spy.assert_emitted(@array![(oapp_address, expected_event_1), (oapp_address, expected_event_2)]);
}

// =============================== Test Remove Peer =================================

#[test]
fn test_remove_peer() {
    let TestSetup { oapp_address, oapp_dispatcher, .. } = setup();
    let mut spy = spy_events();

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());
    assert_eq(oapp_dispatcher.get_peer(EID_1), MOCK_PEER_1());

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, ZERO_PEER());
    assert_eq(oapp_dispatcher.get_peer(EID_1), ZERO_PEER());

    let expected_removal_event = MockOAppCore::Event::OAppCoreEvent(
        OAppCoreComponent::Event::PeerSet(PeerSet { eid: EID_1, peer: ZERO_PEER() }),
    );
    spy.assert_emitted(@array![(oapp_address, expected_removal_event)]);
}

// =============================== Test Peer Independence =================================

#[test]
fn test_peer_independence() {
    let TestSetup { oapp_address, oapp_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());

    assert_eq(oapp_dispatcher.get_peer(EID_1), MOCK_PEER_1());
    assert_eq(oapp_dispatcher.get_peer(EID_2), ZERO_PEER());
    assert_eq(oapp_dispatcher.get_peer(UNKNOWN_EID), ZERO_PEER());
}

// =============================== Test Ownership =================================

#[test]
fn test_ownership_initial_setup() {
    let TestSetup { ownable_dispatcher, .. } = setup();
    assert(ownable_dispatcher.owner() == OWNER, 'Initial owner incorrect');
}

#[test]
fn test_transfer_ownership() {
    let TestSetup { oapp_address, oapp_dispatcher, ownable_dispatcher, .. } = setup();
    let new_owner = 'new_owner'.try_into().unwrap();

    cheat_caller_address_once(oapp_address, OWNER);
    ownable_dispatcher.transfer_ownership(new_owner);

    assert_eq(ownable_dispatcher.owner(), new_owner);

    cheat_caller_address_once(oapp_address, new_owner);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());

    assert(oapp_dispatcher.get_peer(EID_1) == MOCK_PEER_1(), 'New owner should set peer');
}

#[test]
#[feature("safe_dispatcher")]
fn test_old_owner_cannot_set_peer_after_transfer() {
    let TestSetup { oapp_address, ownable_dispatcher, oapp_safe_dispatcher, .. } = setup();
    let new_owner = 'new_owner'.try_into().unwrap();

    start_cheat_caller_address(oapp_address, OWNER);
    ownable_dispatcher.transfer_ownership(new_owner);
    let result = oapp_safe_dispatcher.set_peer(EID_1, MOCK_PEER_1());

    assert_panic_with_felt_error(result, OwnableComponent::Errors::NOT_OWNER);
}

// =============================== Test LayerZero Receiver =================================

#[test]
fn test_lz_receive_success() {
    let TestSetup { oapp_address, lz_receiver_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, FAKE_ENDPOINT);
    lz_receiver_dispatcher
        .lz_receive(MOCK_ORIGIN(), MOCK_GUID(), MOCK_MESSAGE(), EXECUTOR, Default::default(), 0);
}

#[test]
#[feature("safe_dispatcher")]
fn test_lz_receive_fails_non_endpoint() {
    let TestSetup { oapp_address, lz_receiver_safe_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, NON_OWNER);
    let result = lz_receiver_safe_dispatcher
        .lz_receive(MOCK_ORIGIN(), MOCK_GUID(), MOCK_MESSAGE(), EXECUTOR, Default::default(), 0);

    assert_panic_with_error(result, err_only_endpoint(FAKE_ENDPOINT));
}

#[test]
#[feature("safe_dispatcher")]
fn test_lz_receive_fails_unknown_peer() {
    let TestSetup { oapp_address, lz_receiver_safe_dispatcher, .. } = setup();
    let unknown_origin = Origin {
        src_eid: UNKNOWN_EID, sender: Bytes32 { value: 0x999 }, nonce: 1,
    };

    cheat_caller_address_once(oapp_address, FAKE_ENDPOINT);
    let result = lz_receiver_safe_dispatcher
        .lz_receive(unknown_origin, MOCK_GUID(), MOCK_MESSAGE(), EXECUTOR, Default::default(), 0);

    assert_panic_with_error(result, err_no_peer(UNKNOWN_EID));
}

#[test]
fn test_allow_initialize_path() {
    let TestSetup { lz_receiver_dispatcher, .. } = setup();

    let is_allowed = lz_receiver_dispatcher.allow_initialize_path(MOCK_ORIGIN());
    assert(is_allowed, 'Path should be allowed');

    let unknown_origin = Origin {
        src_eid: UNKNOWN_EID, sender: Bytes32 { value: 0x999 }, nonce: 1,
    };
    let is_not_allowed = lz_receiver_dispatcher.allow_initialize_path(unknown_origin);
    assert(!is_not_allowed, 'Unknown path not allowed');
}

#[test]
fn test_next_nonce() {
    let TestSetup { lz_receiver_dispatcher, .. } = setup();

    let nonce = lz_receiver_dispatcher.next_nonce(SRC_EID, MOCK_PEER_1());
    assert_eq(nonce, 0);
}

// =============================== Test OApp Receiver =================================

#[test]
fn test_is_compose_msg_sender() {
    let TestSetup { oapp_address, oapp_receiver_dispatcher, .. } = setup();

    let is_sender = oapp_receiver_dispatcher
        .is_compose_msg_sender(MOCK_ORIGIN(), MOCK_MESSAGE(), oapp_address);
    assert(is_sender, 'Contract should be valid sender');

    let is_not_sender = oapp_receiver_dispatcher
        .is_compose_msg_sender(MOCK_ORIGIN(), MOCK_MESSAGE(), NON_OWNER);
    assert(!is_not_sender, 'Other address not valid sender');
}

// =============================== Test OApp Sender =================================

// =============================== Test Quote =================================

#[test]
fn test_quote_success() {
    let TestSetup { mock_oapp_core_dispatcher, .. } = setup();

    // mock endpoint to return a 100 10 message fee
    let expected_result = MessagingFee { native_fee: 100, lz_token_fee: 10 };

    start_mock_call(FAKE_ENDPOINT, selector!("quote"), expected_result.clone());
    let fee = mock_oapp_core_dispatcher
        .test_quote(EID_1, MOCK_MESSAGE(), Default::default(), false);

    assert_eq(fee, expected_result);
}

#[test]
#[feature("safe_dispatcher")]
fn test_quote_fails_unknown_peer() {
    let TestSetup { mock_oapp_core_safe_dispatcher, .. } = setup();

    let result = mock_oapp_core_safe_dispatcher
        .test_quote(UNKNOWN_EID, MOCK_MESSAGE(), Default::default(), false);

    assert_panic_with_error(result, err_no_peer(UNKNOWN_EID));
}

// =============================== Test Pay in Token =================================

#[test]
fn test_pay_in_token() {
    // Should take the money into Oapp and approve the endpoint to spend it
    let TestSetup { oapp_address, mock_oapp_core_dispatcher, stark_token_dispatcher, .. } = setup();
    cheat_caller_address_once(stark_token_dispatcher.contract_address, OWNER);
    stark_token_dispatcher.approve(oapp_address, 100);

    mock_oapp_core_dispatcher
        .test_pay_in_token(
            OWNER, FAKE_ENDPOINT, oapp_address, 100, stark_token_dispatcher.contract_address,
        );

    let stark_balance = stark_token_dispatcher.balance_of(oapp_address);
    assert_eq(stark_balance, 100);
    let endpoint_allowance = stark_token_dispatcher.allowance(oapp_address, FAKE_ENDPOINT);
    assert_eq(endpoint_allowance, 100);
}

// =============================== Test Pay LZ Token =================================

#[test]
fn test_pay_lz_token() {
    let TestSetup { oapp_address, mock_oapp_core_dispatcher, lz_token_dispatcher, .. } = setup();
    cheat_caller_address_once(lz_token_dispatcher.contract_address, OWNER);
    lz_token_dispatcher.approve(oapp_address, 100);

    mock_oapp_core_dispatcher.test_pay_lz_token(OWNER, FAKE_ENDPOINT, oapp_address, 100);

    let lz_balance = lz_token_dispatcher.balance_of(oapp_address);
    assert_eq(lz_balance, 100);
    let endpoint_allowance = lz_token_dispatcher.allowance(oapp_address, FAKE_ENDPOINT);
    assert_eq(endpoint_allowance, 100);
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_lz_token_fails_not_enough_lz_token_allowance() {
    let TestSetup { oapp_address, mock_oapp_core_safe_dispatcher, .. } = setup();
    cheat_caller_address_once(oapp_address, OWNER);
    let result = mock_oapp_core_safe_dispatcher
        .test_pay_lz_token(OWNER, FAKE_ENDPOINT, oapp_address, 100);

    assert_panic_with_error(result, err_not_enough_lz_token_allowance(100, 0));
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_lz_token_with_oapp_as_caller_succeeds_when_enough_lz_token_without_allowance() {
    let TestSetup { oapp_address, mock_oapp_core_dispatcher, lz_token_dispatcher, .. } = setup();
    let oapp_lz_token_balance = 100;
    let lz_token_fee = 100;

    cheat_caller_address_once(lz_token_dispatcher.contract_address, OWNER);
    lz_token_dispatcher.transfer(oapp_address, oapp_lz_token_balance);

    cheat_caller_address_once(oapp_address, OWNER);
    mock_oapp_core_dispatcher
        .test_pay_lz_token(oapp_address, FAKE_ENDPOINT, oapp_address, lz_token_fee);
    assert_eq(lz_token_dispatcher.allowance(oapp_address, FAKE_ENDPOINT), lz_token_fee);
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_lz_token_fails_not_enough_lz_token() {
    let TestSetup { oapp_address, mock_oapp_core_safe_dispatcher, .. } = setup();
    cheat_caller_address_once(oapp_address, OWNER);
    let result = mock_oapp_core_safe_dispatcher
        .test_pay_lz_token(NON_OWNER, FAKE_ENDPOINT, oapp_address, 100);
    assert_panic_with_error(result, err_not_enough_lz_token(100, 0));
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_lz_token_with_oapp_as_caller_fails_not_enough_lz_token() {
    let TestSetup {
        oapp_address, mock_oapp_core_safe_dispatcher, lz_token_dispatcher, ..,
    } = setup();
    let oapp_lz_token_balance = 99;
    let lz_token_fee = 100;

    cheat_caller_address_once(lz_token_dispatcher.contract_address, OWNER);
    lz_token_dispatcher.transfer(oapp_address, oapp_lz_token_balance);

    cheat_caller_address_once(oapp_address, OWNER);
    let result = mock_oapp_core_safe_dispatcher
        .test_pay_lz_token(oapp_address, FAKE_ENDPOINT, oapp_address, lz_token_fee);
    assert_panic_with_error(result, err_not_enough_lz_token(lz_token_fee, oapp_lz_token_balance));
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_lz_token_fails_lz_token_unavailable() {
    // Deploy OApp with zero LZ token address
    let stark_token = deploy_test_erc20(OWNER);
    mock_call(FAKE_ENDPOINT, selector!("set_delegate"), (), 1);
    let oapp_address = deploy_test_oapp_core(FAKE_ENDPOINT, OWNER, stark_token);
    // mock lz token to be unavailable
    start_mock_call(FAKE_ENDPOINT, selector!("get_lz_token"), ZERO_ADDRESS);
    let mock_oapp_core_safe_dispatcher = IMockOAppCoreSafeDispatcher {
        contract_address: oapp_address,
    };

    let result = mock_oapp_core_safe_dispatcher
        .test_pay_lz_token(OWNER, FAKE_ENDPOINT, oapp_address, 100);

    assert_panic_with_error(result, err_lz_token_unavailable());
}

// =============================== Test Pay Native =================================

#[test]
fn test_pay_native() {
    let TestSetup { oapp_address, mock_oapp_core_dispatcher, stark_token_dispatcher, .. } = setup();
    cheat_caller_address_once(stark_token_dispatcher.contract_address, OWNER);
    stark_token_dispatcher.approve(oapp_address, 100);
    mock_oapp_core_dispatcher.test_pay_native(OWNER, FAKE_ENDPOINT, oapp_address, 100);

    let stark_balance = stark_token_dispatcher.balance_of(oapp_address);
    assert_eq(stark_balance, 100);
    let endpoint_allowance = stark_token_dispatcher.allowance(oapp_address, FAKE_ENDPOINT);
    assert_eq(endpoint_allowance, 100);
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_native_fails_not_enough_native_allowance() {
    let TestSetup { oapp_address, mock_oapp_core_safe_dispatcher, .. } = setup();
    cheat_caller_address_once(oapp_address, OWNER);
    let result = mock_oapp_core_safe_dispatcher
        .test_pay_native(OWNER, FAKE_ENDPOINT, oapp_address, 100);
    assert_panic_with_error(result, err_not_enough_native_allowance(100, 0));
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_native_fails_not_enough_native() {
    let TestSetup { oapp_address, mock_oapp_core_safe_dispatcher, .. } = setup();
    cheat_caller_address_once(oapp_address, OWNER);
    let result = mock_oapp_core_safe_dispatcher
        .test_pay_native(NON_OWNER, FAKE_ENDPOINT, oapp_address, 100);
    assert_panic_with_error(result, err_not_enough_native(100, 0));
}

#[test]
#[feature("safe_dispatcher")]
fn test_pay_native_with_oapp_as_caller_fails_not_enough_native() {
    let TestSetup {
        oapp_address, mock_oapp_core_safe_dispatcher, stark_token_dispatcher, ..,
    } = setup();
    let oapp_native_token_balance = 99;
    let pay_amount = 100;

    cheat_caller_address_once(stark_token_dispatcher.contract_address, OWNER);
    stark_token_dispatcher.transfer(oapp_address, oapp_native_token_balance);

    cheat_caller_address_once(oapp_address, OWNER);
    let result = mock_oapp_core_safe_dispatcher
        .test_pay_native(oapp_address, FAKE_ENDPOINT, oapp_address, pay_amount);
    assert_panic_with_error(result, err_not_enough_native(pay_amount, oapp_native_token_balance));
}


// =============================== Test LZ Send =================================

#[test]
fn test_lz_send_success() {
    let TestSetup {
        oapp_address, mock_oapp_core_dispatcher, stark_token_dispatcher, lz_token_dispatcher, ..,
    } = setup();
    let message = MOCK_MESSAGE();
    let options = Default::default();
    let fee = MessagingFee { native_fee: 100, lz_token_fee: 10 };
    let refund_address = OWNER;

    let expected_receipt = MessageReceipt {
        guid: Bytes32 { value: 0x1 }, nonce: 0, payees: array![],
    };

    start_mock_call(FAKE_ENDPOINT, selector!("send"), expected_receipt.clone());

    // Set up STARK token approval
    cheat_caller_address_once(stark_token_dispatcher.contract_address, OWNER);
    stark_token_dispatcher.approve(oapp_address, 100);

    // Set up LZ token approval
    cheat_caller_address_once(lz_token_dispatcher.contract_address, OWNER);
    lz_token_dispatcher.approve(oapp_address, 10);

    // Now make the lz_send call with OWNER as caller to the OApp
    cheat_caller_address_once(oapp_address, OWNER);
    let receipt = mock_oapp_core_dispatcher
        .test_lz_send(OWNER, EID_1, message, options, fee, refund_address);
    assert_eq(receipt, expected_receipt);

    // Check that money was taken from the caller and allowance was set to endpoint
    // in this mock the endpoint doesn't do anything so the allowance will still be the
    // given values
    let stark_balance = stark_token_dispatcher.balance_of(OWNER);
    assert_eq(stark_balance, INITIAL_SUPPLY - 100);

    let oapp_stark_balance = stark_token_dispatcher.balance_of(oapp_address);
    assert_eq(oapp_stark_balance, 100);

    let endpoint_allowance = stark_token_dispatcher.allowance(oapp_address, FAKE_ENDPOINT);
    assert_eq(endpoint_allowance, 100);

    let lz_balance = lz_token_dispatcher.balance_of(OWNER);
    assert_eq(lz_balance, INITIAL_SUPPLY - 10);

    let oapp_lz_balance = lz_token_dispatcher.balance_of(oapp_address);
    assert_eq(oapp_lz_balance, 10);

    let endpoint_allowance = lz_token_dispatcher.allowance(oapp_address, FAKE_ENDPOINT);
    assert_eq(endpoint_allowance, 10);
}

#[test]
#[feature("safe_dispatcher")]
fn test_lz_send_with_oapp_as_caller_succeeds() {
    let TestSetup { oapp_address, mock_oapp_core_dispatcher, stark_token_dispatcher, .. } = setup();
    let oapp_native_token_balance = 200;
    let native_fee = 100;

    let expected_receipt = MessageReceipt {
        guid: Bytes32 { value: 0x1 }, nonce: 0, payees: array![],
    };

    start_mock_call(FAKE_ENDPOINT, selector!("send"), expected_receipt.clone());

    // mint oapp native token
    cheat_caller_address_once(stark_token_dispatcher.contract_address, OWNER);
    stark_token_dispatcher.transfer(oapp_address, oapp_native_token_balance);

    cheat_caller_address_once(oapp_address, OWNER);
    let receipt = mock_oapp_core_dispatcher
        .test_lz_send(
            oapp_address,
            EID_1,
            MOCK_MESSAGE(),
            Default::default(),
            MessagingFee { native_fee, lz_token_fee: 0 },
            OWNER,
        );
    assert_eq!(receipt, expected_receipt);

    // check that the oapp native token allowance is set to the native fee to the endpoint
    let oapp_native_token_allowance = stark_token_dispatcher.allowance(oapp_address, FAKE_ENDPOINT);
    assert_eq!(oapp_native_token_allowance, native_fee);
}

#[test]
#[feature("safe_dispatcher")]
fn test_lz_send_fails_not_peer() {
    let TestSetup { mock_oapp_core_safe_dispatcher, .. } = setup();

    let result = mock_oapp_core_safe_dispatcher
        .test_lz_send(
            OWNER,
            UNKNOWN_EID,
            MOCK_MESSAGE(),
            Default::default(),
            MessagingFee { native_fee: 0, lz_token_fee: 0 },
            OWNER,
        );

    assert_panic_with_error(result, err_no_peer(UNKNOWN_EID));
}

#[test]
#[feature("safe_dispatcher")]
#[fuzzer(runs: 10)]
fn test_lz_send_transfer_failure(native_fee_seed: u256) {
    let native_fee = native_fee_seed % INITIAL_SUPPLY;
    let TestSetup {
        oapp_address, mock_oapp_core_safe_dispatcher, stark_token_dispatcher, ..,
    } = setup();

    cheat_caller_address_once(stark_token_dispatcher.contract_address, OWNER);
    stark_token_dispatcher.transfer(USER, native_fee);

    cheat_caller_address_once(stark_token_dispatcher.contract_address, USER);
    stark_token_dispatcher.approve(oapp_address, native_fee);

    start_mock_call(stark_token_dispatcher.contract_address, selector!("transfer_from"), false);

    cheat_caller_address_once(oapp_address, USER);
    let result = mock_oapp_core_safe_dispatcher
        .test_lz_send(
            USER,
            EID_1,
            MOCK_MESSAGE(),
            Default::default(),
            MessagingFee { native_fee, lz_token_fee: 0 },
            refund_address: USER,
        );

    assert_panic_with_error(result, err_transfer_failed());
}

#[test]
#[feature("safe_dispatcher")]
#[fuzzer(runs: 10)]
fn test_lz_send_approval_failure(native_fee_seed: u256) {
    let native_fee = native_fee_seed % INITIAL_SUPPLY;
    let TestSetup {
        oapp_address, mock_oapp_core_safe_dispatcher, stark_token_dispatcher, ..,
    } = setup();

    cheat_caller_address_once(stark_token_dispatcher.contract_address, OWNER);
    stark_token_dispatcher.transfer(USER, native_fee);

    cheat_caller_address_once(stark_token_dispatcher.contract_address, USER);
    stark_token_dispatcher.approve(oapp_address, native_fee);

    start_mock_call(stark_token_dispatcher.contract_address, selector!("approve"), false);

    cheat_caller_address_once(oapp_address, USER);
    let result = mock_oapp_core_safe_dispatcher
        .test_lz_send(
            USER,
            EID_1,
            MOCK_MESSAGE(),
            Default::default(),
            MessagingFee { native_fee, lz_token_fee: 0 },
            refund_address: USER,
        );

    assert_panic_with_error(result, err_approval_failed());
}

// =============================== Essential LZ Receive Tests =================================

#[test]
#[feature("safe_dispatcher")]
fn test_lz_receive_fails_wrong_caller() {
    let TestSetup { oapp_address, lz_receiver_safe_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, NON_OWNER);
    let result = lz_receiver_safe_dispatcher
        .lz_receive(MOCK_ORIGIN(), MOCK_GUID(), MOCK_MESSAGE(), EXECUTOR, Default::default(), 0);

    assert_panic_with_error(result, err_only_endpoint(FAKE_ENDPOINT));
}

#[test]
#[feature("safe_dispatcher")]
fn test_lz_receive_fails_unregistered_peer() {
    let TestSetup { oapp_address, lz_receiver_safe_dispatcher, .. } = setup();
    let unknown_origin = Origin { src_eid: UNKNOWN_EID, sender: MOCK_PEER_1(), nonce: 1 };

    cheat_caller_address_once(oapp_address, FAKE_ENDPOINT);
    let result = lz_receiver_safe_dispatcher
        .lz_receive(unknown_origin, MOCK_GUID(), MOCK_MESSAGE(), EXECUTOR, Default::default(), 0);

    assert_panic_with_error(result, err_no_peer(UNKNOWN_EID));
}

#[test]
fn test_lz_receive_multi_chain() {
    let TestSetup { oapp_address, oapp_dispatcher, lz_receiver_dispatcher, .. } = setup();

    // Set up peers for different chains
    start_cheat_caller_address(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());
    oapp_dispatcher.set_peer(EID_2, MOCK_PEER_2());
    stop_cheat_caller_address(oapp_address);

    start_cheat_caller_address(oapp_address, FAKE_ENDPOINT);

    let origin_chain1 = Origin { src_eid: EID_1, sender: MOCK_PEER_1(), nonce: 1 };
    let origin_chain2 = Origin { src_eid: EID_2, sender: MOCK_PEER_2(), nonce: 1 };

    lz_receiver_dispatcher
        .lz_receive(origin_chain1, MOCK_GUID(), "chain1 msg", EXECUTOR, Default::default(), 0);
    lz_receiver_dispatcher
        .lz_receive(origin_chain2, MOCK_GUID(), "chain2 msg", EXECUTOR, Default::default(), 0);
}

#[test]
#[feature("safe_dispatcher")]
fn test_lz_receive_fails_wrong_sender_for_chain() {
    let TestSetup { oapp_address, oapp_dispatcher, lz_receiver_safe_dispatcher, .. } = setup();

    // Set up peer for EID_1
    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_peer(EID_1, MOCK_PEER_1());

    // Try wrong sender for EID_1
    let invalid_origin = Origin { src_eid: EID_1, sender: MOCK_PEER_2(), nonce: 1 };

    cheat_caller_address_once(oapp_address, FAKE_ENDPOINT);
    let result = lz_receiver_safe_dispatcher
        .lz_receive(invalid_origin, MOCK_GUID(), MOCK_MESSAGE(), EXECUTOR, Default::default(), 0);

    assert_panic_with_error(result, err_only_peer(EID_1, MOCK_PEER_2()));
}

#[test]
fn test_lz_receive_empty_message() {
    let TestSetup { oapp_address, lz_receiver_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, FAKE_ENDPOINT);
    lz_receiver_dispatcher
        .lz_receive(MOCK_ORIGIN(), MOCK_GUID(), "", EXECUTOR, Default::default(), 0);
}

// =============================== Test Set Delegate =================================

#[test]
fn test_set_delegate() {
    let TestSetup { oapp_address, oapp_dispatcher, .. } = setup();

    start_mock_call(FAKE_ENDPOINT, selector!("set_delegate"), OWNER);

    cheat_caller_address_once(oapp_address, OWNER);
    oapp_dispatcher.set_delegate(OWNER);
}

#[test]
#[feature("safe_dispatcher")]
fn test_set_delegate_fails_not_owner() {
    let TestSetup { oapp_address, oapp_safe_dispatcher, .. } = setup();

    cheat_caller_address_once(oapp_address, NON_OWNER);
    let result = oapp_safe_dispatcher.set_delegate(OWNER);
    assert_panic_with_felt_error(result, OwnableComponent::Errors::NOT_OWNER);
}
