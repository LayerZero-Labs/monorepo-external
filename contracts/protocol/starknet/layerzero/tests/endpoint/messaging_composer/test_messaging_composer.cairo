//! Messaging composer tests

use layerzero::endpoint::constants::EMPTY_PAYLOAD_HASH;
use layerzero::endpoint::messaging_composer::errors::{
    err_lz_compose_already_exists, err_lz_compose_not_found, err_lz_compose_value_exceeds_allowance,
    err_transfer_failed,
};
use layerzero::endpoint::messaging_composer::events::{
    ComposeDelivered, ComposeSent, LzComposeAlert,
};
use layerzero::endpoint::messaging_composer::interface::{
    IMessagingComposerDispatcherTrait, IMessagingComposerSafeDispatcherTrait,
};
use layerzero::endpoint::messaging_composer::messaging_composer::MessagingComposerComponent;
use lz_utils::bytes::Bytes32;
use lz_utils::keccak::keccak256;
use openzeppelin::token::erc20::interface::IERC20DispatcherTrait;
use snforge_std::{
    EventSpyAssertionsTrait, spy_events, start_cheat_caller_address, start_mock_call,
    stop_cheat_caller_address,
};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::{assert_panic_with_error, cheat_caller_address_once};
use crate::endpoint::messaging_composer::utils::{
    MessagingComposerMock, deploy_messaging_composer, mint_and_approve_for_executor,
};
use crate::fuzzable::bytes32::FuzzableBytes32;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::felt_array::{Felt252ArrayList, FuzzableFelt252ArrayList};
use crate::mocks::composer_target::MockComposerTarget::IMockComposerTargetInspectDispatcherTrait;
use crate::mocks::messaging_composer::MockMessagingComposer;

#[test]
#[fuzzer(runs: 10)]
fn should_send_compose_and_emit_event(
    sender: ContractAddress, to: ContractAddress, guid: Bytes32, index: u16, msg: ByteArray,
) {
    let MessagingComposerMock { messaging_composer, dispatcher, .. } = deploy_messaging_composer();
    let message: ByteArray = msg.clone();

    let mut spy = spy_events();

    cheat_caller_address_once(messaging_composer, sender);
    dispatcher.send_compose(to, guid, index, message.clone());

    let expected_event = MockMessagingComposer::Event::MessagingComposerEvent(
        MessagingComposerComponent::Event::ComposeSent(
            ComposeSent { from: sender, to, guid, index, message },
        ),
    );
    spy.assert_emitted(@array![(messaging_composer, expected_event)]);

    // get_compose_queue should return stored hash (non-zero)
    let stored: Bytes32 = dispatcher.get_compose_queue(sender, to, guid, index);
    assert(stored != EMPTY_PAYLOAD_HASH, 'non-zero hash');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_when_send_compose_twice_same_key(
    sender: ContractAddress, to: ContractAddress, guid: Bytes32, index: u16, msg: ByteArray,
) {
    let MessagingComposerMock {
        messaging_composer, dispatcher, safe_dispatcher, ..,
    } = deploy_messaging_composer();
    let message: ByteArray = msg.clone();

    start_cheat_caller_address(messaging_composer, sender);
    dispatcher.send_compose(to, guid, index, message.clone());
    let res = safe_dispatcher.send_compose(to, guid, index, message);
    assert_panic_with_error(res, err_lz_compose_already_exists());
}

#[test]
#[fuzzer(runs: 10)]
fn should_lz_compose_success_and_transfer_value(
    from: ContractAddress,
    executor: ContractAddress,
    guid: Bytes32,
    index: u16,
    msg: ByteArray,
    value: u256,
) {
    let MessagingComposerMock {
        messaging_composer, dispatcher, token_dispatcher, target_address, target_inspect, ..,
    } = deploy_messaging_composer();
    let message: ByteArray = msg.clone();
    let extra_data: ByteArray = Default::default();
    let value: u256 = (value % 1_000_000_u256) + 1_u256;

    // sender sends compose
    cheat_caller_address_once(messaging_composer, from);
    dispatcher.send_compose(target_address, guid, index, message.clone());

    // mint and approve value to composer contract as `executor` (the caller)
    mint_and_approve_for_executor(token_dispatcher, executor, messaging_composer, value);

    // record balances before compose
    let to_balance_before = token_dispatcher.balance_of(target_address);
    let exec_balance_before = token_dispatcher.balance_of(executor);

    // call lz_compose from an executor/caller with allowance of "from"
    cheat_caller_address_once(messaging_composer, executor);
    let mut spy = spy_events();
    dispatcher.lz_compose(from, target_address, guid, index, message, extra_data, value);

    // expect delivered event
    let expected_event = MockMessagingComposer::Event::MessagingComposerEvent(
        MessagingComposerComponent::Event::ComposeDelivered(
            ComposeDelivered { from, to: target_address, guid, index },
        ),
    );
    spy.assert_emitted(@array![(messaging_composer, expected_event)]);

    // validate target side effects
    let received = target_inspect.received_count();
    assert(received > 0, 'target should receive compose');

    // validate token transfer effects
    let to_balance_after = token_dispatcher.balance_of(target_address);
    let exec_balance_after = token_dispatcher.balance_of(executor);
    assert(to_balance_after == to_balance_before + value, 'to recv value');
    assert(exec_balance_after + value == exec_balance_before, 'exec paid value');

    // target should record last_value
    let last_v = target_inspect.last_value();
    assert(last_v == value, 'last_value == value');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_lz_compose_when_message_hash_mismatch(
    from: ContractAddress, guid: Bytes32, index: u16, m1: ByteArray, m2: ByteArray,
) {
    let MessagingComposerMock {
        messaging_composer, dispatcher, safe_dispatcher, target_address, ..,
    } = deploy_messaging_composer();

    cheat_caller_address_once(messaging_composer, from);
    dispatcher.send_compose(target_address, guid, index, m1.clone());

    let m2_copy: ByteArray = m2.clone();
    let res = safe_dispatcher
        .lz_compose(from, target_address, guid, index, m2_copy, Default::default(), 0_u256);

    let expected_hash = keccak256(@m1);
    let actual_hash = keccak256(@m2);
    assert_panic_with_error(res, err_lz_compose_not_found(expected_hash, actual_hash));

    // queue should remain the same (not marked as received)
    let stored = dispatcher.get_compose_queue(from, target_address, guid, index);
    let received_sentinel = Bytes32 { value: 0x1 };
    assert(stored != received_sentinel, 'not received');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_lz_compose_when_value_exceeds_allowance(
    from: ContractAddress, guid: Bytes32, index: u16, msg: ByteArray,
) {
    let MessagingComposerMock {
        messaging_composer, dispatcher, safe_dispatcher, token_dispatcher, target_address, ..,
    } = deploy_messaging_composer();
    let value: u256 = 1000_u256;

    // send compose
    cheat_caller_address_once(messaging_composer, from);
    dispatcher.send_compose(target_address, guid, index, msg.clone());

    // approve less than value as the executor; set executor == from
    cheat_caller_address_once(token_dispatcher.contract_address, from);
    token_dispatcher.approve(messaging_composer, 100_u256);

    // ensure executor == from for this call
    cheat_caller_address_once(messaging_composer, from);
    let res = safe_dispatcher
        .lz_compose(from, target_address, guid, index, msg, Default::default(), value);
    assert_panic_with_error(res, err_lz_compose_value_exceeds_allowance(value, 100_u256));
}

#[test]
#[fuzzer(runs: 10)]
fn should_emit_compose_alert(
    from: ContractAddress,
    to: ContractAddress,
    executor: ContractAddress,
    guid: Bytes32,
    index: u16,
    gas: u256,
    value: u256,
    message: ByteArray,
    extra_data: ByteArray,
    reason: Felt252ArrayList,
) {
    let MessagingComposerMock { messaging_composer, dispatcher, .. } = deploy_messaging_composer();
    let gas: u256 = gas % 10_000_u256;
    let value: u256 = value % 1_000_000_u256;

    start_cheat_caller_address(messaging_composer, executor);
    let mut spy = spy_events();
    dispatcher
        .lz_compose_alert(
            from,
            to,
            guid,
            index,
            gas,
            value,
            message.clone(),
            extra_data.clone(),
            reason.arr.clone(),
        );
    stop_cheat_caller_address(messaging_composer);

    let expected_event = MockMessagingComposer::Event::MessagingComposerEvent(
        MessagingComposerComponent::Event::LzComposeAlert(
            LzComposeAlert {
                from,
                to,
                executor,
                guid,
                index,
                gas,
                value,
                message,
                extra_data,
                reason: reason.arr,
            },
        ),
    );
    spy.assert_emitted(@array![(messaging_composer, expected_event)]);

    // also ensure no state mutation occurs in queue for alert
    let queue: Bytes32 = dispatcher.get_compose_queue(from, to, guid, index);
    assert(queue == EMPTY_PAYLOAD_HASH, 'no alert queue change');
    // do not invoke lz_compose here since `to` is arbitrary and may not be deployed
}

#[test]
#[fuzzer(runs: 10)]
fn queued_hash_matches_keccak(from: ContractAddress, guid: Bytes32, index: u16, msg: ByteArray) {
    let m = deploy_messaging_composer();

    start_cheat_caller_address(m.messaging_composer, from);
    m.dispatcher.send_compose(m.target_address, guid, index, msg.clone());
    stop_cheat_caller_address(m.messaging_composer);

    let stored = m.dispatcher.get_compose_queue(from, m.target_address, guid, index);
    let expected = keccak256(@msg);
    assert(stored == expected, 'hash mismatch');

    // default read for unknown key should be zero
    let unknown: Bytes32 = m
        .dispatcher
        .get_compose_queue(from, m.target_address, guid, index + 1_u16);
    assert(unknown == EMPTY_PAYLOAD_HASH, 'unknown key should return 0');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn lz_compose_without_prior_send_fails(
    from: ContractAddress, guid: Bytes32, index: u16, msg: ByteArray,
) {
    let m = deploy_messaging_composer();
    use layerzero::endpoint::messaging_composer::interface::IMessagingComposerSafeDispatcher;
    let safe = IMessagingComposerSafeDispatcher { contract_address: m.messaging_composer };

    let res = safe
        .lz_compose(from, m.target_address, guid, index, msg.clone(), Default::default(), 0_u256);
    let expected_hash = EMPTY_PAYLOAD_HASH;
    let actual_hash = keccak256(@msg);
    assert_panic_with_error(res, err_lz_compose_not_found(expected_hash, actual_hash));
}

#[test]
#[fuzzer(runs: 10)]
fn zero_value_requires_no_allowance(
    from: ContractAddress, executor: ContractAddress, guid: Bytes32, index: u16, msg: ByteArray,
) {
    let m = deploy_messaging_composer();

    start_cheat_caller_address(m.messaging_composer, from);
    m.dispatcher.send_compose(m.target_address, guid, index, msg.clone());
    stop_cheat_caller_address(m.messaging_composer);

    start_cheat_caller_address(m.messaging_composer, executor);
    let mut spy = spy_events();
    m
        .dispatcher
        .lz_compose(from, m.target_address, guid, index, msg.clone(), Default::default(), 0_u256);
    stop_cheat_caller_address(m.messaging_composer);

    // queue should now be RECEIVED_MESSAGE_HASH (1)
    let q = m.dispatcher.get_compose_queue(from, m.target_address, guid, index);
    let received_sentinel = Bytes32 { value: 0x1 };
    assert(q == received_sentinel, 'expected received sentinel');

    // delivered event should be emitted
    let expected_event = MockMessagingComposer::Event::MessagingComposerEvent(
        MessagingComposerComponent::Event::ComposeDelivered(
            ComposeDelivered { from, to: m.target_address, guid, index },
        ),
    );
    spy.assert_emitted(@array![(m.messaging_composer, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
fn value_equals_allowance_succeeds(
    from: ContractAddress,
    executor: ContractAddress,
    guid: Bytes32,
    index: u16,
    msg: ByteArray,
    value: u256,
) {
    let v: u256 = (value % 1_000_000_u256) + 1_u256;
    let m = deploy_messaging_composer();

    cheat_caller_address_once(m.messaging_composer, from);
    m.dispatcher.send_compose(m.target_address, guid, index, msg.clone());

    // mint and approve from executor (caller)
    mint_and_approve_for_executor(m.token_dispatcher, executor, m.messaging_composer, v);

    // record balances
    let to_before = m.token_dispatcher.balance_of(m.target_address);
    let exec_before = m.token_dispatcher.balance_of(executor);

    cheat_caller_address_once(m.messaging_composer, executor);
    m
        .dispatcher
        .lz_compose(from, m.target_address, guid, index, msg.clone(), Default::default(), v);

    let q = m.dispatcher.get_compose_queue(from, m.target_address, guid, index);
    let received_sentinel = Bytes32 { value: 0x1 };
    assert(q == received_sentinel, 'expected received sentinel');

    // verify balances and target last_value
    let to_after = m.token_dispatcher.balance_of(m.target_address);
    let exec_after = m.token_dispatcher.balance_of(executor);
    assert(to_after == to_before + v, 'to recv value');
    assert(exec_after + v == exec_before, 'exec paid value');

    let last_v = m.target_inspect.last_value();
    assert(last_v == v, 'last_value == value');
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn lz_compose_cannot_be_replayed(
    from: ContractAddress,
    executor: ContractAddress,
    guid: Bytes32,
    index: u16,
    msg: ByteArray,
    value: u256,
) {
    let v: u256 = (value % 1_000_000_u256) + 1_u256;
    let m = deploy_messaging_composer();

    // initial send
    cheat_caller_address_once(m.messaging_composer, from);
    m.dispatcher.send_compose(m.target_address, guid, index, msg.clone());

    // mint and approve exact value from executor (caller)
    mint_and_approve_for_executor(m.token_dispatcher, executor, m.messaging_composer, v);

    // deliver once
    cheat_caller_address_once(m.messaging_composer, executor);
    m
        .dispatcher
        .lz_compose(from, m.target_address, guid, index, msg.clone(), Default::default(), v);

    // queue must be sentinel
    let q = m.dispatcher.get_compose_queue(from, m.target_address, guid, index);
    let received_sentinel = Bytes32 { value: 0x1 };
    assert(q == received_sentinel, 'expected received sentinel');

    // replay fails with not found
    let res = m
        .safe_dispatcher
        .lz_compose(from, m.target_address, guid, index, msg.clone(), Default::default(), v);
    let expected_hash = received_sentinel;
    let actual_hash = keccak256(@msg);
    assert_panic_with_error(res, err_lz_compose_not_found(expected_hash, actual_hash));

    // re-sending compose with same key should fail (exists)
    cheat_caller_address_once(m.messaging_composer, from);
    let res2 = m.safe_dispatcher.send_compose(m.target_address, guid, index, Default::default());
    assert_panic_with_error(res2, err_lz_compose_already_exists());
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn lz_compose_fails_when_transfer_fails(
    from: ContractAddress,
    executor: ContractAddress,
    guid: Bytes32,
    index: u16,
    msg: ByteArray,
    value: u256,
) {
    let value: u256 = (value % 1_000_000_u256) + 1_u256;
    let MessagingComposerMock {
        messaging_composer, dispatcher, token_dispatcher, target_address, safe_dispatcher, ..,
    } = deploy_messaging_composer();

    // Initial send
    cheat_caller_address_once(messaging_composer, from);
    dispatcher.send_compose(target_address, guid, index, msg.clone());

    // Mint and approve exact value from executor (caller)
    mint_and_approve_for_executor(token_dispatcher, executor, messaging_composer, value);

    // Transfer fails
    start_mock_call(token_dispatcher.contract_address, selector!("transfer_from"), false);
    cheat_caller_address_once(messaging_composer, executor);
    let res = safe_dispatcher
        .lz_compose(from, target_address, guid, index, msg.clone(), Default::default(), value);

    // Check lz_compose fails when transfer fails
    assert_panic_with_error(res, err_transfer_failed());
}

#[test]
#[fuzzer(runs: 10)]
fn different_senders_and_targets_are_isolated(
    from1: ContractAddress, from2: ContractAddress, guid: Bytes32, index: u16, msg: ByteArray,
) {
    let m = deploy_messaging_composer();

    // sender 1 queues to target A
    cheat_caller_address_once(m.messaging_composer, from1);
    m.dispatcher.send_compose(m.target_address, guid, index, msg.clone());

    // sender 2 can queue same key independently
    cheat_caller_address_once(m.messaging_composer, from2);
    m.dispatcher.send_compose(m.target_address, guid, index, msg.clone());

    // different target isolation: same from/guid/index but new target
    let m2 = deploy_messaging_composer();
    cheat_caller_address_once(m2.messaging_composer, from1);
    m2.dispatcher.send_compose(m2.target_address, guid, index, msg.clone());

    // all queues should be non-zero and independent
    let q1: Bytes32 = m.dispatcher.get_compose_queue(from1, m.target_address, guid, index);
    let q2: Bytes32 = m.dispatcher.get_compose_queue(from2, m.target_address, guid, index);
    let q3: Bytes32 = m2.dispatcher.get_compose_queue(from1, m2.target_address, guid, index);
    assert(
        q1 != EMPTY_PAYLOAD_HASH && q2 != EMPTY_PAYLOAD_HASH && q3 != EMPTY_PAYLOAD_HASH,
        'queues should be populated',
    );
    assert(q1 == q2 && q1 == q3, 'hashes match');
}

