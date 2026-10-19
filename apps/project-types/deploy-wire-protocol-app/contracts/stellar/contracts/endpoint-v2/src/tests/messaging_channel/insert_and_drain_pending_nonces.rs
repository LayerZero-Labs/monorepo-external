use soroban_sdk::{testutils::Address as _, Address, BytesN};

use crate::{endpoint_v2::EndpointV2, tests::endpoint_setup::setup};

fn insert_and_drain(
    context: &crate::tests::endpoint_setup::TestSetup,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
) {
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::insert_and_drain_pending_nonces_for_test(env, receiver, src_eid, sender, nonce)
    });
}

#[test]
fn test_insert_and_drain_inserts_sorted_and_dedupes() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Start with inbound_nonce = 0.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());

    // Insert out of order: 3 then 2. Pending should remain sorted.
    insert_and_drain(&context, &receiver, src_eid, &sender, 3);
    insert_and_drain(&context, &receiver, src_eid, &sender, 2);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(
        endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender),
        soroban_sdk::vec![env, 2u64, 3u64]
    );

    // Re-inserting an already pending nonce should be a no-op (no duplicates, no drain).
    insert_and_drain(&context, &receiver, src_eid, &sender, 2);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(
        endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender),
        soroban_sdk::vec![env, 2u64, 3u64]
    );

    insert_and_drain(&context, &receiver, src_eid, &sender, 1);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
fn test_insert_and_drain_drains_consecutive_sequence() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Insert 2 and 3, then insert 1. Inserting 1 should drain 1,2,3 and advance inbound_nonce to 3.
    insert_and_drain(&context, &receiver, src_eid, &sender, 2);
    insert_and_drain(&context, &receiver, src_eid, &sender, 3);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(
        endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender),
        soroban_sdk::vec![env, 2u64, 3u64]
    );

    insert_and_drain(&context, &receiver, src_eid, &sender, 1);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
fn test_insert_and_drain_leaves_nonconsecutive_tail_pending() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Insert 2 and 4, then insert 1. Drain should advance to 2 but leave 4 pending (gap at 3).
    insert_and_drain(&context, &receiver, src_eid, &sender, 2);
    insert_and_drain(&context, &receiver, src_eid, &sender, 4);
    insert_and_drain(&context, &receiver, src_eid, &sender, 1);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 4u64]);
}

#[test]
fn test_insert_and_drain_accepts_upper_bound_when_inbound_nonce_zero() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // inbound_nonce == 0: 256 is allowed.
    insert_and_drain(&context, &receiver, src_eid, &sender, 256);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 256u64]);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_insert_and_drain_rejects_beyond_upper_bound_when_inbound_nonce_zero() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // inbound_nonce == 0: 257 is out of range (max is 256).
    insert_and_drain(&context, &receiver, src_eid, &sender, 257);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_insert_and_drain_rejects_nonce_leq_inbound_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Advance inbound_nonce to 5 via storage utility.
    context.set_inbound_nonce(&receiver, src_eid, &sender, 5);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 5);

    // Calling with new_nonce == inbound_nonce should panic InvalidNonce.
    insert_and_drain(&context, &receiver, src_eid, &sender, 5);
}

#[test]
fn test_insert_and_drain_accepts_upper_bound_when_inbound_nonce_nonzero() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // inbound_nonce == 100: upper bound is 356 (= 100 + 256).
    context.set_inbound_nonce(&receiver, src_eid, &sender, 100);
    insert_and_drain(&context, &receiver, src_eid, &sender, 356);

    // Not consecutive to 100, so it remains pending and inbound_nonce does not advance.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 100);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 356u64]);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_insert_and_drain_rejects_beyond_upper_bound_when_inbound_nonce_nonzero() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    context.set_inbound_nonce(&receiver, src_eid, &sender, 100);

    // inbound_nonce == 100: 357 is out of range (max is 356).
    insert_and_drain(&context, &receiver, src_eid, &sender, 357);
}

#[test]
fn test_insert_and_drain_drains_across_existing_pending_tail_when_inbound_nonce_nonzero() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Set inbound_nonce to 2.
    context.set_inbound_nonce(&receiver, src_eid, &sender, 2);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);

    // Insert 4 first -> pending [4], inbound_nonce remains 2 (missing 3).
    insert_and_drain(&context, &receiver, src_eid, &sender, 4);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 4u64]);

    // Insert 3 -> should drain 3 then 4 and advance inbound_nonce to 4.
    insert_and_drain(&context, &receiver, src_eid, &sender, 3);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 4);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
fn test_insert_and_drain_drains_single_next_nonce_when_no_pending() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    context.set_inbound_nonce(&receiver, src_eid, &sender, 5);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 5);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());

    // Insert exactly inbound_nonce + 1. This should drain immediately and leave pending empty.
    insert_and_drain(&context, &receiver, src_eid, &sender, 6);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 6);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
fn test_insert_and_drain_window_holds_255_when_inbound_plus_one_missing_then_drains() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Fill the pending window with 2..=256 while nonce 1 is still missing.
    // This creates 255 pending nonces and inbound_nonce remains 0.
    for nonce in 2u64..=256u64 {
        insert_and_drain(&context, &receiver, src_eid, &sender, nonce);
    }

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    let pending = endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender);
    assert_eq!(pending.len(), 255);
    assert_eq!(pending.get(0).unwrap(), 2u64);
    assert_eq!(pending.get(254).unwrap(), 256u64);

    // Inserting nonce 1 closes the gap and drains the entire window.
    insert_and_drain(&context, &receiver, src_eid, &sender, 1);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 256);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_insert_and_drain_rejects_257_when_missing_inbound_plus_one() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Keep inbound_nonce at 0 and fill 2..=256 into pending.
    for nonce in 2u64..=256u64 {
        insert_and_drain(&context, &receiver, src_eid, &sender, nonce);
    }

    // 257 is outside the allowed range (0, 256] while inbound_nonce is still 0.
    insert_and_drain(&context, &receiver, src_eid, &sender, 257);
}
