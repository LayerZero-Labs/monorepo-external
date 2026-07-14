extern crate std;

use crate::{
    codec::MsgType,
    integration_tests::{setup_uln::*, utils::*},
    tests::mint_to,
};
use message_lib_common::packet_codec_v1;
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, IntoVal,
};
use uln302::ReceiveUln302Client;

#[test]
fn test_increment_vanilla() {
    let TestSetup { env, chain_a, chain_b } = wired_setup_with_dvn_mode(DvnMode::Single);

    let sender = Address::generate(&env);
    let options = create_default_options(&env);
    let fee = quote(&chain_a, chain_b.eid, MsgType::Vanilla, &options);

    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, MsgType::Vanilla, &options, &fee);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet = validate_packet(&env, &chain_b, &packet_event);

    // Execute via executor using the packet options value.
    let executor_value_b = get_executor_value_from_options(&env, &packet_event.1);
    let admin = Address::generate(&env);
    lz_receive_via_executor(&env, &chain_b, &admin, &packet, executor_value_b);

    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
}

#[test]
fn test_increment_aba() {
    let TestSetup { env, chain_a, chain_b } = wired_setup_with_dvn_mode(DvnMode::Single);

    let sender = Address::generate(&env);
    let msg_type = MsgType::ABA;

    // Quote return fee first, then embed it as value in the send options.
    let return_options = create_aba_return_options(&env);
    let fee_b_to_a = quote(&chain_b, chain_a.eid, MsgType::Vanilla, &return_options);
    let fee_with_buffer = fee_b_to_a.native_fee + fee_b_to_a.native_fee / 100; // 1% buffer
                                                                               // ABA message doesn't use lz_compose, so pass 0 for lz_compose params
    let options = create_options_with_gas_and_value(&env, 100000, fee_with_buffer as u128, 0, 0);

    let fee_a_to_b = quote(&chain_a, chain_b.eid, msg_type, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee_a_to_b.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, msg_type, &options, &fee_a_to_b);

    // validate packet on Chain B
    let packet_event_chain_a = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet_chain_a = validate_packet(&env, &chain_b, &packet_event_chain_a);

    // Deliver the message on Chain B via executor_helper using the packet options value.
    let executor_value_b = get_executor_value_from_options(&env, &packet_event_chain_a.1);
    let admin = Address::generate(&env);
    lz_receive_via_executor(&env, &chain_b, &admin, &packet_chain_a, executor_value_b);

    // validate packet on Chain A
    let packet_event_chain_b = scan_packet_sent_event(&env, &chain_b.endpoint.address).unwrap();
    let packet_chain_b = validate_packet(&env, &chain_a, &packet_event_chain_b);

    // Extract executor value from the actual packet options
    let executor_value = get_executor_value_from_options(&env, &packet_event_chain_b.1);
    // deliver the message on Chain A via executor_helper
    lz_receive_via_executor(&env, &chain_a, &admin, &packet_chain_b, executor_value);

    // state assertion
    assert_eq!(chain_a.counter.count(), 1);
    assert_eq!(chain_a.counter.inbound_count(&chain_b.eid), 1);
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);

    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
}

#[test]
fn test_increment_composed() {
    let TestSetup { env, chain_a, chain_b } = wired_setup_with_dvn_mode(DvnMode::Single);

    let sender = Address::generate(&env);
    let msg_type = MsgType::Composed;
    // Composed message needs lzCompose gas for execution
    let options = create_options_with_gas(&env, 100000, 100000);

    let fee = quote(&chain_a, chain_b.eid, msg_type, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, msg_type, &options, &fee);

    // validate packet on Chain B
    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet = validate_packet(&env, &chain_b, &packet_event);

    // deliver the message on Chain B via executor_helper
    let executor_value_b = get_executor_value_from_options(&env, &packet_event.1);
    let admin = Address::generate(&env);
    lz_receive_via_executor(&env, &chain_b, &admin, &packet, executor_value_b);

    // scan compose_sent event emitted by lz_receive
    let compose_event = scan_compose_sent_event(&env, &chain_b.endpoint.address);
    assert!(compose_event.is_some(), "compose_sent event should be emitted");
    let (from, to, guid, index, _message) = compose_event.unwrap();
    assert_eq!(from, chain_b.counter.address);
    assert_eq!(to, chain_b.counter.address);
    assert_eq!(guid, packet.guid);
    assert_eq!(index, 0);

    // execute lz_compose via executor_helper
    let compose_value_b = get_compose_value_from_options(&env, &packet_event.1);
    lz_compose_via_executor(&env, &chain_b, &admin, &packet, compose_value_b);

    // state assertion
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
    assert_eq!(chain_b.counter.composed_count(), 1);
}

#[test]
fn test_increment_composed_aba() {
    let TestSetup { env, chain_a, chain_b } = wired_setup_with_dvn_mode(DvnMode::Single);

    let sender = Address::generate(&env);
    let msg_type = MsgType::ComposedABA;

    // Quote return fee first, then embed it as value in the send options.
    let return_options = create_composed_aba_return_options(&env);
    let fee_b_to_a = quote(&chain_b, chain_a.eid, MsgType::Vanilla, &return_options);
    let fee_with_buffer = fee_b_to_a.native_fee + fee_b_to_a.native_fee / 100; // 1% buffer
                                                                               // ComposedABA uses lz_compose to send the return message, so include lzCompose gas and value
    let options = create_options_with_gas_and_value(&env, 100000, 0, 100000, fee_with_buffer as u128);

    let fee_a_to_b = quote(&chain_a, chain_b.eid, msg_type, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee_a_to_b.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, msg_type, &options, &fee_a_to_b);

    // validate packet on Chain B
    let packet_event_chain_a = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet_chain_a = validate_packet(&env, &chain_b, &packet_event_chain_a);

    // Deliver the message on Chain B via executor_helper using the packet options value.
    let executor_value_b = get_executor_value_from_options(&env, &packet_event_chain_a.1);
    let admin = Address::generate(&env);
    lz_receive_via_executor(&env, &chain_b, &admin, &packet_chain_a, executor_value_b);

    // scan compose_sent event emitted by lz_receive
    let compose_event = scan_compose_sent_event(&env, &chain_b.endpoint.address);
    assert!(compose_event.is_some(), "compose_sent event should be emitted");
    let (from, to, guid, index, _message) = compose_event.unwrap();
    assert_eq!(from, chain_b.counter.address);
    assert_eq!(to, chain_b.counter.address);
    assert_eq!(guid, packet_chain_a.guid);
    assert_eq!(index, 0);

    // execute lz_compose on Chain B (lz_send happens inside)
    let compose_value_b = get_compose_value_from_options(&env, &packet_event_chain_a.1);
    lz_compose_via_executor(&env, &chain_b, &admin, &packet_chain_a, compose_value_b);

    // validate packet on Chain A (packet emitted on Chain B)
    let packet_event_chain_b = scan_packet_sent_event(&env, &chain_b.endpoint.address).unwrap();
    let packet_chain_b = validate_packet(&env, &chain_a, &packet_event_chain_b);

    // Extract executor value from the actual packet options
    let executor_value = get_executor_value_from_options(&env, &packet_event_chain_b.1);
    // deliver the message on Chain A via executor_helper
    lz_receive_via_executor(&env, &chain_a, &admin, &packet_chain_b, executor_value);

    // state assertion
    assert_eq!(chain_a.counter.count(), 1);
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_a.counter.inbound_count(&chain_b.eid), 1);

    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
    assert_eq!(chain_b.counter.outbound_count(&chain_a.eid), 1);
    assert_eq!(chain_b.counter.composed_count(), 1);
}

// ============================================================================
// Multi-DVN Verification Tests
// ============================================================================

/// Multi-DVN: both DVNs required (no optional threshold)
#[test]
fn test_multi_dvn_two_required() {
    let TestSetup { env, chain_a, chain_b } = wired_setup_with_dvn_mode(DvnMode::TwoRequired);

    // Send a message A → B
    let sender = Address::generate(&env);
    let options = create_default_options(&env);
    let fee = quote(&chain_a, chain_b.eid, MsgType::Vanilla, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, MsgType::Vanilla, &options, &fee);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet = decode_packet(&env, &packet_event.0);
    let encoded_header = packet_codec_v1::encode_packet_header(&env, &packet);
    let payload_hash = packet_codec_v1::payload_hash(&env, &packet);

    let receive_uln302 = ReceiveUln302Client::new(&env, &chain_b.uln302.address);

    // Verify with first DVN only - should NOT be verifiable yet (need 2 DVNs)
    env.mock_auths(&[MockAuth {
        address: &chain_b.dvn.address,
        invoke: &MockAuthInvoke {
            contract: &chain_b.uln302.address,
            fn_name: "verify",
            args: (&chain_b.dvn.address, &encoded_header, &payload_hash, &CONFIRMATIONS).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_uln302.verify(&chain_b.dvn.address, &encoded_header, &payload_hash, &CONFIRMATIONS);

    // Check verifiable status - should be false (only 1 of 2 required DVNs verified)
    let is_verifiable = receive_uln302.verifiable(&encoded_header, &payload_hash);
    assert!(!is_verifiable, "Should NOT be verifiable with only 1 DVN");

    // Verify with second DVN
    env.mock_auths(&[MockAuth {
        address: &chain_b.dvn2.address,
        invoke: &MockAuthInvoke {
            contract: &chain_b.uln302.address,
            fn_name: "verify",
            args: (&chain_b.dvn2.address, &encoded_header, &payload_hash, &CONFIRMATIONS).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_uln302.verify(&chain_b.dvn2.address, &encoded_header, &payload_hash, &CONFIRMATIONS);

    // Now should be verifiable (both required DVNs verified)
    let is_verifiable = receive_uln302.verifiable(&encoded_header, &payload_hash);
    assert!(is_verifiable, "Should be verifiable with both DVNs");

    // Commit and deliver
    receive_uln302.commit_verification(&encoded_header, &payload_hash);

    let executor_value_b = get_executor_value_from_options(&env, &packet_event.1);
    let admin = Address::generate(&env);
    lz_receive_via_executor(&env, &chain_b, &admin, &packet, executor_value_b);

    // State assertions
    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
}

/// Multi-DVN: duplicate DVN in required+optional (optional threshold = 1)
#[test]
fn test_multi_dvn_duplicate_required_optional() {
    let TestSetup { env, chain_a, chain_b } = wired_setup_with_dvn_mode(DvnMode::DuplicateOptional);

    // Send a message A → B
    let sender = Address::generate(&env);
    let options = create_default_options(&env);
    let fee = quote(&chain_a, chain_b.eid, MsgType::Vanilla, &options);
    mint_to(&env, &chain_a.owner, &chain_a.native_token, &sender, fee.native_fee);
    increment(&env, &chain_a, &sender, chain_b.eid, MsgType::Vanilla, &options, &fee);

    let packet_event = scan_packet_sent_event(&env, &chain_a.endpoint.address).unwrap();
    let packet = decode_packet(&env, &packet_event.0);
    let encoded_header = packet_codec_v1::encode_packet_header(&env, &packet);
    let payload_hash = packet_codec_v1::payload_hash(&env, &packet);

    let receive_uln302 = ReceiveUln302Client::new(&env, &chain_b.uln302.address);

    // Verify with DVN only - because DVN is present in both required and optional lists (optional threshold = 1),
    // this alone should satisfy verifiability.
    env.mock_auths(&[MockAuth {
        address: &chain_b.dvn.address,
        invoke: &MockAuthInvoke {
            contract: &chain_b.uln302.address,
            fn_name: "verify",
            args: (&chain_b.dvn.address, &encoded_header, &payload_hash, &CONFIRMATIONS).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_uln302.verify(&chain_b.dvn.address, &encoded_header, &payload_hash, &CONFIRMATIONS);

    let is_verifiable = receive_uln302.verifiable(&encoded_header, &payload_hash);
    assert!(is_verifiable, "Should be verifiable with duplicate DVN satisfying required + optional");

    // Optionally verify with dvn2 (not required, but matches SUI pattern)
    env.mock_auths(&[MockAuth {
        address: &chain_b.dvn2.address,
        invoke: &MockAuthInvoke {
            contract: &chain_b.uln302.address,
            fn_name: "verify",
            args: (&chain_b.dvn2.address, &encoded_header, &payload_hash, &CONFIRMATIONS).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_uln302.verify(&chain_b.dvn2.address, &encoded_header, &payload_hash, &CONFIRMATIONS);

    let is_verifiable = receive_uln302.verifiable(&encoded_header, &payload_hash);
    assert!(is_verifiable, "Should be verifiable once optional threshold is met");

    receive_uln302.commit_verification(&encoded_header, &payload_hash);

    let executor_value_b = get_executor_value_from_options(&env, &packet_event.1);
    let admin = Address::generate(&env);
    lz_receive_via_executor(&env, &chain_b, &admin, &packet, executor_value_b);

    assert_eq!(chain_a.counter.outbound_count(&chain_b.eid), 1);
    assert_eq!(chain_b.counter.count(), 1);
    assert_eq!(chain_b.counter.inbound_count(&chain_a.eid), 1);
}
