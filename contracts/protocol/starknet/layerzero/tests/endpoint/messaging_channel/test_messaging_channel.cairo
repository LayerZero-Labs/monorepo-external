//! MessagingChannel Component Tests
//!
//! Comprehensive test suite for the MessagingChannel component covering:
//! - Nonce management (inbound/outbound)
//! - Message lifecycle operations (skip, nilify, burn)
//! - Payload hash verification
//! - GUID generation
//! - Error conditions and edge cases

use layerzero::Origin;
use layerzero::common::guid::GUID;
use layerzero::endpoint::constants::{EMPTY_PAYLOAD_HASH, NIL_PAYLOAD_HASH};
use layerzero::endpoint::messaging_channel::errors::{err_invalid_nonce, err_payload_hash_not_found};
use layerzero::endpoint::messaging_channel::events::{
    InboundNonceSkipped, PacketBurnt, PacketNilified,
};
use layerzero::endpoint::messaging_channel::interface::IMessagingChannelDispatcherTrait;
use layerzero::endpoint::messaging_channel::messaging_channel::MessagingChannelComponent;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use lz_utils::keccak::keccak256;
use snforge_std::fuzzable::{FuzzableByteArray1000ASCII, FuzzableU32, FuzzableU64};
use snforge_std::{EventSpyAssertionsTrait, spy_events};
use starknet::ContractAddress;
use starkware_utils_testing::test_utils::assert_panic_with_error;
use crate::fuzzable::bytes32::FuzzableBytes32;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::inbound_params::FuzzableInboundSetupParams;
use crate::fuzzable::small_byte_array::{
    FuzzableByteArray, FuzzableByteArrayArray, SmallByteArray, SmallByteArrayList,
};
use crate::mocks::messaging_channel::interface::{
    IMockMessagingChannelDispatcherTrait, IMockMessagingChannelSafeDispatcherTrait,
};
use crate::mocks::messaging_channel::messaging_channel::MockMessagingChannel;
use super::utils::{
    InboundSetupParams, MessagingChannelMock, _build_payload, deploy_messaging_channel,
    setup_inbound_state,
};


// =============================== Test Skip Functionality =================================

#[test]
#[fuzzer(runs: 10)]
fn should_skip(eid: u32, oapp: ContractAddress, sender: Bytes32, params: InboundSetupParams) {
    let InboundSetupParams { committed_until, .. } = params;

    let MessagingChannelMock {
        helper_dispatcher, dispatcher, messaging_channel, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    let next_nonce = committed_until + 1;

    let mut spy = spy_events();
    helper_dispatcher.test_skip(oapp, Origin { src_eid: eid, sender, nonce: next_nonce });

    // Verify the skip functionality
    assert(dispatcher.inbound_nonce(oapp, eid, sender) == next_nonce, 'should be skipped');
    assert(dispatcher.lazy_inbound_nonce(oapp, eid, sender) == next_nonce, 'should be skipped');

    let expected_event = MockMessagingChannel::Event::MessagingChannelEvent(
        MessagingChannelComponent::Event::InboundNonceSkipped(
            InboundNonceSkipped { receiver: oapp, src_eid: eid, sender, nonce: next_nonce },
        ),
    );

    // Verify the InboundNonceSkipped event was emitted
    spy.assert_emitted(@array![(messaging_channel, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_skip_with_invalid_nonce(
    eid: u32,
    oapp: ContractAddress,
    sender: Bytes32,
    invalid_nonce: u64,
    params: InboundSetupParams,
) {
    let InboundSetupParams { executed_until: _, committed_until } = params;
    if invalid_nonce == committed_until + 1 {
        return;
    }

    let MessagingChannelMock {
        helper_safe_dispatcher, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    assert_panic_with_error(
        helper_safe_dispatcher
            .test_skip(oapp, Origin { src_eid: eid, sender, nonce: invalid_nonce }),
        err_invalid_nonce(),
    );
}

// =============================== Test Nilify Functionality =================================

#[test]
#[fuzzer(runs: 10)]
fn should_nilify(
    eid: u32,
    oapp: ContractAddress,
    sender: Bytes32,
    nonce: u64,
    payload_hash: Bytes32,
    params: InboundSetupParams,
) {
    let MessagingChannelMock {
        dispatcher, helper_dispatcher, messaging_channel, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    let origin = Origin { src_eid: eid, sender, nonce };
    helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);

    let mut spy = spy_events();
    helper_dispatcher.test_nilify(oapp, origin, payload_hash);

    // Verify the nilify functionality
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, nonce) == NIL_PAYLOAD_HASH,
        'should be nilified',
    );

    let expected_event = MockMessagingChannel::Event::MessagingChannelEvent(
        MessagingChannelComponent::Event::PacketNilified(
            PacketNilified { receiver: oapp, src_eid: eid, sender, nonce, payload_hash },
        ),
    );

    // Verify the PacketNilified event was emitted
    spy.assert_emitted(@array![(messaging_channel, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_nilify_with_missmatch_payload_hash(
    eid: u32,
    oapp: ContractAddress,
    sender: Bytes32,
    nonce: u64,
    expected_payload_hash: Bytes32,
    actual_payload_hash: Bytes32,
    params: InboundSetupParams,
) {
    let InboundSetupParams { executed_until: _, committed_until: _ } = params;

    let MessagingChannelMock {
        helper_dispatcher, helper_safe_dispatcher, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    let origin = Origin { src_eid: eid, sender, nonce };
    helper_dispatcher.fake_commit(oapp, origin.clone(), actual_payload_hash);

    assert_panic_with_error(
        helper_safe_dispatcher.test_nilify(oapp, origin, expected_payload_hash),
        err_payload_hash_not_found(expected_payload_hash, actual_payload_hash),
    );
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_nilify_with_invalid_nonce(
    eid: u32, oapp: ContractAddress, sender: Bytes32, params: InboundSetupParams,
) {
    let InboundSetupParams { executed_until, .. } = params;

    let MessagingChannelMock {
        helper_safe_dispatcher, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    // empty since it was executed since lazy inbound nonce is gonna be > nonce
    let payload_hash = Bytes32 { value: 0 };

    assert_panic_with_error(
        helper_safe_dispatcher
            .test_nilify(
                oapp, Origin { src_eid: eid, sender, nonce: executed_until }, payload_hash,
            ),
        err_invalid_nonce(),
    );
}

// =============================== Test Burn Functionality =================================

#[test]
#[fuzzer(runs: 10)]
fn should_burn(
    eid: u32,
    oapp: ContractAddress,
    sender: Bytes32,
    payload_hash: Bytes32,
    params: InboundSetupParams,
) {
    // we want to have a not committed, alraedy checked payload
    if params.executed_until + 2 > params.committed_until {
        return;
    }

    let MessagingChannelMock {
        dispatcher, helper_dispatcher, messaging_channel, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    // execute executed_until + 2
    let payload = _build_payload(eid, sender, params.executed_until + 2);
    let payload_hash = keccak256(@payload);
    let origin = Origin { src_eid: eid, sender, nonce: params.executed_until + 2 };
    helper_dispatcher.test_clear_payload(oapp, origin, payload);

    let nonce = params.executed_until + 1;
    let origin = Origin { src_eid: eid, sender, nonce };
    helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);

    let mut spy = spy_events();
    helper_dispatcher.test_burn(oapp, origin, payload_hash);

    // Verify the burn functionality
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, nonce) == EMPTY_PAYLOAD_HASH,
        'should be burnt',
    );

    let expected_event = MockMessagingChannel::Event::MessagingChannelEvent(
        MessagingChannelComponent::Event::PacketBurnt(
            PacketBurnt { receiver: oapp, src_eid: eid, sender, nonce, payload_hash },
        ),
    );

    // Verify the PacketBurnt event was emitted
    spy.assert_emitted(@array![(messaging_channel, expected_event)]);
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_burn_with_mismatch_payload_hash(
    eid: u32,
    oapp: ContractAddress,
    sender: Bytes32,
    expected_payload_hash: Bytes32,
    actual_payload_hash: Bytes32,
    params: InboundSetupParams,
) {
    if expected_payload_hash.value == actual_payload_hash.value {
        return;
    }

    let InboundSetupParams { executed_until: _, committed_until: _ } = params;

    let MessagingChannelMock {
        helper_dispatcher, helper_safe_dispatcher, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    let nonce = params.committed_until + 1;
    let origin = Origin { src_eid: eid, sender, nonce };
    helper_dispatcher.fake_commit(oapp, origin.clone(), actual_payload_hash);

    assert_panic_with_error(
        helper_safe_dispatcher.test_burn(oapp, origin, expected_payload_hash),
        err_payload_hash_not_found(expected_payload_hash, actual_payload_hash),
    );
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_burn_if_executed(
    eid: u32, oapp: ContractAddress, sender: Bytes32, params: InboundSetupParams,
) {
    let InboundSetupParams { executed_until: _, committed_until: _ } = params;

    let MessagingChannelMock {
        helper_safe_dispatcher, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    let nonce = 0;
    let payload_hash = Bytes32 { value: 0 };
    assert_panic_with_error(
        helper_safe_dispatcher
            .test_burn(oapp, Origin { src_eid: eid, sender, nonce }, payload_hash),
        err_invalid_nonce(),
    );
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_burn_with_invalid_nonce(
    eid: u32,
    oapp: ContractAddress,
    sender: Bytes32,
    payload_hash: Bytes32,
    invalid_nonce: u64,
    params: InboundSetupParams,
) {
    let InboundSetupParams { executed_until, committed_until: _ } = params;
    // skip if the invalid nonce is smaller than the executed nonce
    if invalid_nonce <= executed_until {
        return;
    }

    let MessagingChannelMock {
        helper_safe_dispatcher, helper_dispatcher, ..,
    } = setup_inbound_state(eid, oapp, sender, params);

    let origin = Origin { src_eid: eid, sender: sender, nonce: invalid_nonce };
    helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);

    assert_panic_with_error(
        helper_safe_dispatcher.test_burn(oapp, origin, payload_hash), err_invalid_nonce(),
    );
}

// =============================== Test Inbound Nonce Functionality
// =================================

#[test]
#[fuzzer(runs: 10)]
fn should_get_inbound_nonce(
    eid: u32, oapp: ContractAddress, receiver: Bytes32, params: InboundSetupParams,
) {
    let InboundSetupParams { executed_until: _, committed_until } = params;

    let MessagingChannelMock { dispatcher, .. } = setup_inbound_state(eid, oapp, receiver, params);

    let inbound_nonce = dispatcher.inbound_nonce(oapp, eid, receiver);
    assert(inbound_nonce == committed_until, 'should be the next nonce');
}

// Validates lazy and inbound nonce after setup across fuzzed ranges
#[test]
#[fuzzer(runs: 10)]
fn should_setup_inbound_state_fuzzed(
    eid: u32, oapp: ContractAddress, sender: Bytes32, params: InboundSetupParams,
) {
    let InboundSetupParams { executed_until, committed_until } = params;

    let MessagingChannelMock { dispatcher, .. } = setup_inbound_state(eid, oapp, sender, params);

    assert(dispatcher.lazy_inbound_nonce(oapp, eid, sender) == executed_until, 'lazy mismatch');
    assert(dispatcher.inbound_nonce(oapp, eid, sender) == committed_until, 'inbound mismatch');
}

// After setup with committed_until == executed_until, skipping the next nonce should succeed
#[test]
#[fuzzer(runs: 10)]
fn should_skip_next_after_setup(
    eid: u32, oapp: ContractAddress, sender: Bytes32, executed_until: u64,
) {
    let executed_until = executed_until % 50;
    let MessagingChannelMock {
        helper_dispatcher, dispatcher, ..,
    } =
        setup_inbound_state(
            eid,
            oapp,
            sender,
            InboundSetupParams { executed_until, committed_until: executed_until },
        );

    let next = executed_until + 1;
    helper_dispatcher.test_skip(oapp, Origin { src_eid: eid, sender, nonce: next });
    assert(dispatcher.lazy_inbound_nonce(oapp, eid, sender) == next, 'lazy should be next');
    assert(dispatcher.inbound_nonce(oapp, eid, sender) == next, 'inbound should be next');
}

// =============================== Test Clear Payload Functionality
// =================================

#[test]
#[fuzzer(runs: 10)]
fn should_clear_payload(eid: u32, oapp: ContractAddress, sender: Bytes32, payload: ByteArray) {
    let MessagingChannelMock { dispatcher, helper_dispatcher, .. } = deploy_messaging_channel(eid);

    let nonce = 1;
    let payload_hash = keccak256(@payload);
    let origin = Origin { src_eid: eid, sender, nonce };

    // Set up a verified payload
    helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);

    // Verify payload hash is stored
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, nonce) == payload_hash,
        'payload hash should be stored',
    );

    // Clear the payload
    helper_dispatcher.test_clear_payload(oapp, origin, payload);

    // Verify payload hash is cleared (set to EMPTY_PAYLOAD_HASH)
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, nonce) == EMPTY_PAYLOAD_HASH,
        'payload should be cleared',
    );

    // Verify lazy nonce is updated
    assert(
        dispatcher.lazy_inbound_nonce(oapp, eid, sender) == nonce, 'lazy nonce should be updated',
    );
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, nonce) == EMPTY_PAYLOAD_HASH,
        'payload should be cleared',
    );
}

#[test]
#[fuzzer(runs: 10)]
fn should_clear_payload_with_multiple_nonces(
    eid: u32, oapp: ContractAddress, sender: Bytes32, payload_small_byte_arrays: SmallByteArrayList,
) {
    let payloads: Array<ByteArray> = payload_small_byte_arrays
        .arr
        .into_iter()
        .map(|ba| ba.ba)
        .collect();
    let MessagingChannelMock { dispatcher, helper_dispatcher, .. } = deploy_messaging_channel(eid);

    for (i, payload) in payloads.clone().into_iter().enumerate() {
        let origin = Origin { src_eid: eid, sender, nonce: i.into() };
        let payload_hash = keccak256(@payload);
        helper_dispatcher.fake_commit(oapp, origin, payload_hash);
    }

    for (i, payload) in payloads.clone().into_iter().enumerate() {
        let origin = Origin { src_eid: eid, sender, nonce: i.into() };
        helper_dispatcher.test_clear_payload(oapp, origin, payload);
        assert(
            dispatcher.inbound_payload_hash(oapp, eid, sender, i.into()) == EMPTY_PAYLOAD_HASH,
            'payload should be cleared',
        );
        assert(
            dispatcher.lazy_inbound_nonce(oapp, eid, sender) == i.into(),
            'lazy nonce should be updated',
        );
    }
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_clear_payload_with_wrong_hash(
    eid: u32, oapp: ContractAddress, sender: Bytes32, payload: ByteArray, wrong_payload: ByteArray,
) {
    let MessagingChannelMock {
        helper_safe_dispatcher, helper_dispatcher, ..,
    } = deploy_messaging_channel(eid);

    let origin = Origin { src_eid: eid, sender, nonce: 0 };
    let payload_hash = keccak256(@payload);
    helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);

    assert_panic_with_error(
        helper_safe_dispatcher.test_clear_payload(oapp, origin, wrong_payload.clone()),
        err_payload_hash_not_found(payload_hash, keccak256(@wrong_payload)),
    );
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_clear_payload_with_missing_intermediate_nonce(
    eid: u32, oapp: ContractAddress, sender: Bytes32, payload1: ByteArray, payload3: ByteArray,
) {
    let MessagingChannelMock {
        helper_safe_dispatcher, helper_dispatcher, ..,
    } = deploy_messaging_channel(eid);

    // Set up verified payloads for nonces 1 and 3 (skip nonce 2)
    let origin1 = Origin { src_eid: eid, sender, nonce: 1 };
    helper_dispatcher.fake_commit(oapp, origin1.clone(), keccak256(@payload1));

    let origin3 = Origin { src_eid: eid, sender, nonce: 3 };
    helper_dispatcher.fake_commit(oapp, origin3.clone(), keccak256(@payload3));

    // Try to clear nonce 3 without nonce 2 being verified (should fail)
    assert_panic_with_error(
        helper_safe_dispatcher.test_clear_payload(oapp, origin3, payload3), err_invalid_nonce(),
    );
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_clear_nilified_payload(
    eid: u32, oapp: ContractAddress, sender: Bytes32, payload: ByteArray,
) {
    let MessagingChannelMock {
        dispatcher, helper_safe_dispatcher, helper_dispatcher, ..,
    } = deploy_messaging_channel(eid);

    let nonce = 1;
    let payload_hash = keccak256(@payload);
    let origin = Origin { src_eid: eid, sender, nonce };

    // Set up a verified payload
    helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);

    // Nilify the payload
    helper_dispatcher.test_nilify(oapp, origin.clone(), payload_hash);

    // Verify payload is nilified
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, nonce) == NIL_PAYLOAD_HASH,
        'payload should be nilified',
    );

    // Try to clear the nilified payload
    assert_panic_with_error(
        helper_safe_dispatcher.test_clear_payload(oapp, origin, payload),
        err_payload_hash_not_found(NIL_PAYLOAD_HASH, payload_hash),
    );
}

#[test]
#[fuzzer(runs: 10)]
#[feature("safe_dispatcher")]
fn should_fail_clear_already_executed_payload(
    eid: u32, oapp: ContractAddress, sender: Bytes32, payload: ByteArray,
) {
    let MessagingChannelMock {
        helper_safe_dispatcher, helper_dispatcher, ..,
    } = deploy_messaging_channel(eid);

    let nonce = 1;
    let payload_hash = keccak256(@payload);
    let origin = Origin { src_eid: eid, sender, nonce };

    // Set up a verified payload
    helper_dispatcher.fake_commit(oapp, origin.clone(), payload_hash);

    // Clear the payload (first time should succeed)
    helper_dispatcher.test_clear_payload(oapp, origin.clone(), payload.clone());

    // Try to clear again (should fail because payload hash is now EMPTY_PAYLOAD_HASH)
    assert_panic_with_error(
        helper_safe_dispatcher.test_clear_payload(oapp, origin, payload),
        err_payload_hash_not_found(EMPTY_PAYLOAD_HASH, payload_hash),
    );
}

#[test]
#[fuzzer(runs: 10)]
fn should_clear_payload_out_of_order(
    eid: u32,
    oapp: ContractAddress,
    sender: Bytes32,
    p1: SmallByteArray,
    p2: SmallByteArray,
    p3: SmallByteArray,
) {
    let payload1 = p1.ba;
    let payload2 = p2.ba;
    let payload3 = p3.ba;

    let MessagingChannelMock { dispatcher, helper_dispatcher, .. } = deploy_messaging_channel(eid);

    // Set up multiple verified payloads
    let origin1 = Origin { src_eid: eid, sender, nonce: 1 };
    helper_dispatcher.fake_commit(oapp, origin1.clone(), keccak256(@payload1));
    let origin2 = Origin { src_eid: eid, sender, nonce: 2 };
    helper_dispatcher.fake_commit(oapp, origin2.clone(), keccak256(@payload2));
    let origin3 = Origin { src_eid: eid, sender, nonce: 3 };
    helper_dispatcher.fake_commit(oapp, origin3.clone(), keccak256(@payload3));

    // Clear payload with nonce 3 (should update lazy nonce to 3)
    helper_dispatcher.test_clear_payload(oapp, origin3, payload3);
    assert(dispatcher.lazy_inbound_nonce(oapp, eid, sender) == 3, 'lazy nonce should jump to 3');
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, 3) == EMPTY_PAYLOAD_HASH,
        'payload 3 should be cleared',
    );

    // Clear payload with nonce 1 (should not update lazy nonce)
    helper_dispatcher.test_clear_payload(oapp, origin1, payload1);
    assert(dispatcher.lazy_inbound_nonce(oapp, eid, sender) == 3, 'lazy nonce should remain at 3');
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, 1) == EMPTY_PAYLOAD_HASH,
        'payload 1 should be cleared',
    );

    // Clear payload with nonce 2 (should not update lazy nonce)
    helper_dispatcher.test_clear_payload(oapp, origin2, payload2);
    assert(dispatcher.lazy_inbound_nonce(oapp, eid, sender) == 3, 'lazy nonce should remain at 3');
    assert(
        dispatcher.inbound_payload_hash(oapp, eid, sender, 2) == EMPTY_PAYLOAD_HASH,
        'payload 2 should be cleared',
    );
}

#[test]
#[fuzzer(runs: 10)]
fn should_get_next_guid(
    eid: u32,
    dst_eid: u32,
    oapp: ContractAddress,
    receiver: Bytes32,
    verified_nonces: u64,
    fake_payload: Bytes32,
) {
    // limiting the verified nonces to 100 to avoid resource exhaustion

    let verified_nonces = verified_nonces % 100;

    let MessagingChannelMock { dispatcher, helper_dispatcher, .. } = deploy_messaging_channel(eid);

    for _ in 0..verified_nonces {
        helper_dispatcher.fake_send(oapp, dst_eid, receiver);
    }

    let next_nonce = verified_nonces + 1;

    let next_guid = dispatcher.next_guid(oapp, dst_eid, receiver);

    assert(
        next_guid == GUID::generate(next_nonce, eid, oapp.into(), dst_eid, receiver.into()),
        'should be the next guid',
    );
}
