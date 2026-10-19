use soroban_sdk::{testutils::Address as _, vec, Address, BytesN};

use crate::tests::endpoint_setup::{setup, TestSetup};

// Helpers
fn inbound_as_verified_with_fixed_hash(
    context: &TestSetup,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
) {
    let payload_hash = BytesN::from_array(&context.env, &[0xabu8; 32]);
    context.inbound_as_verified(receiver, src_eid, sender, nonce, &payload_hash);
}

// Initial value
#[test]
fn test_inbound_nonce_initially_zero() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

// Stored inbound nonce is the baseline when there are no pending nonces
#[test]
fn test_inbound_nonce_equals_stored_value_when_no_pending_nonces() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    context.set_inbound_nonce(&receiver, src_eid, &sender, 5);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 5);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

// The inbound_nonce advances through the longest gapless consecutive sequence
#[test]
fn test_inbound_nonce_advances_through_consecutive_verified_payload_hashes() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Start from inbound_nonce = 2 and add payloads at 3,4,5.
    context.set_inbound_nonce(&receiver, src_eid, &sender, 2);
    inbound_as_verified_with_fixed_hash(&context, &receiver, src_eid, &sender, 3);
    inbound_as_verified_with_fixed_hash(&context, &receiver, src_eid, &sender, 4);
    inbound_as_verified_with_fixed_hash(&context, &receiver, src_eid, &sender, 5);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 5);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
fn test_inbound_nonce_stops_at_first_gap() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Start from inbound_nonce = 2 and add payloads at 3 and 5 (gap at 4).
    context.set_inbound_nonce(&receiver, src_eid, &sender, 2);
    inbound_as_verified_with_fixed_hash(&context, &receiver, src_eid, &sender, 3);
    inbound_as_verified_with_fixed_hash(&context, &receiver, src_eid, &sender, 5);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), vec![env, 5u64]);
}

// Path isolation (receiver/src_eid/sender are isolated)
#[test]
fn test_inbound_nonce_isolated_by_path() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver_a = Address::generate(env);
    let receiver_b = Address::generate(env);
    let src_eid_a = 2;
    let src_eid_b = 3;
    let sender_a = BytesN::from_array(env, &[1u8; 32]);
    let sender_b = BytesN::from_array(env, &[2u8; 32]);

    // Path A: inbound 10 + payload at 11 => inbound_nonce 11.
    context.set_inbound_nonce(&receiver_a, src_eid_a, &sender_a, 10);
    inbound_as_verified_with_fixed_hash(&context, &receiver_a, src_eid_a, &sender_a, 11);
    assert_eq!(endpoint_client.inbound_nonce(&receiver_a, &src_eid_a, &sender_a), 11);

    // Path B: different receiver => independent.
    context.set_inbound_nonce(&receiver_b, src_eid_a, &sender_a, 20);
    assert_eq!(endpoint_client.inbound_nonce(&receiver_b, &src_eid_a, &sender_a), 20);

    // Path C: different src_eid => independent (two consecutive payloads).
    context.set_inbound_nonce(&receiver_a, src_eid_b, &sender_a, 30);
    inbound_as_verified_with_fixed_hash(&context, &receiver_a, src_eid_b, &sender_a, 31);
    inbound_as_verified_with_fixed_hash(&context, &receiver_a, src_eid_b, &sender_a, 32);
    assert_eq!(endpoint_client.inbound_nonce(&receiver_a, &src_eid_b, &sender_a), 32);

    // Path D: different sender => independent.
    context.set_inbound_nonce(&receiver_a, src_eid_a, &sender_b, 40);
    assert_eq!(endpoint_client.inbound_nonce(&receiver_a, &src_eid_a, &sender_b), 40);
}
