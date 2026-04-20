use soroban_sdk::{testutils::Address as _, Address, BytesN};

use crate::{endpoint_v2::EndpointV2, storage, tests::endpoint_setup::setup};

// Internal inbound() stores payload hash per nonce and rejects empty payload hash
#[test]
fn test_inbound_success_stores_payload_hash() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]); // Valid non-empty payload hash

    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, nonce, &payload_hash)
    });

    let stored_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(stored_hash, Some(payload_hash.clone()));

    // Different nonce for same path
    let nonce2 = 2;
    let payload_hash2 = BytesN::from_array(env, &[0xcdu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, nonce2, &payload_hash2)
    });
    assert_eq!(
        endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce2),
        Some(payload_hash2.clone())
    );

    // Different receiver should have independent storage
    let different_receiver = Address::generate(env);
    let payload_hash3 = BytesN::from_array(env, &[0xefu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &different_receiver, src_eid, &sender, nonce, &payload_hash3)
    });
    assert_eq!(
        endpoint_client.inbound_payload_hash(&different_receiver, &src_eid, &sender, &nonce),
        Some(payload_hash3)
    );
}

// Inbound() overwrites payload hash for the same (receiver, src_eid, sender, nonce)
#[test]
fn test_inbound_overwrites_same_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;

    let payload_hash_a = BytesN::from_array(env, &[0xabu8; 32]);
    let payload_hash_b = BytesN::from_array(env, &[0xcdu8; 32]);

    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, nonce, &payload_hash_a)
    });
    assert_eq!(
        endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce),
        Some(payload_hash_a.clone())
    );

    // Overwrite the same nonce with a different payload hash.
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, nonce, &payload_hash_b)
    });
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash_b));
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")] // EndpointError::InvalidPayloadHash
fn test_inbound_rejects_empty_payload_hash() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;
    let empty_hash = BytesN::from_array(env, &[0u8; 32]); // empty payload hash is invalid for inbound()

    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, nonce, &empty_hash)
    });
}

#[test]
fn test_inbound_out_of_order_populates_pending_and_drains_when_gap_closed() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    let hash_2 = BytesN::from_array(env, &[0x22u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 2, &hash_2)
    });

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 2u64]);

    let hash_1 = BytesN::from_array(env, &[0x11u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 1, &hash_1)
    });

    // Gap is closed, so pending drains and inbound nonce advances to 2.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &1u64), Some(hash_1));
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2u64), Some(hash_2));
}

#[test]
fn test_inbound_when_nonce_already_pending_does_not_advance_inbound_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // First inbound at nonce 2 adds it to pending (gap at nonce 1).
    let hash_2_a = BytesN::from_array(env, &[0x22u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 2u64, &hash_2_a)
    });
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 2u64]);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2u64), Some(hash_2_a.clone()));

    // Re-inbound at the same nonce should overwrite the payload hash, but should NOT duplicate pending
    // entries nor advance inbound_nonce (gap at nonce 1 still exists).
    let hash_2_b = BytesN::from_array(env, &[0x23u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 2u64, &hash_2_b)
    });
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 2u64]);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2u64), Some(hash_2_b));
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_inbound_rejects_nonce_beyond_pending_window() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let hash = BytesN::from_array(env, &[0xabu8; 32]);

    // inbound_nonce is 0, so nonce 257 is out of range (max is 256).
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 257, &hash)
    });
}

#[test]
fn test_inbound_accepts_upper_bound_when_inbound_nonce_nonzero() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Set inbound_nonce to 100 so the upper bound is 356 (= 100 + 256).
    context.set_inbound_nonce(&receiver, src_eid, &sender, 100);

    let hash = BytesN::from_array(env, &[0xabu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 356u64, &hash)
    });

    // Nonce 356 is not consecutive to 100, so it stays pending and inbound_nonce does not advance.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 100);
    assert_eq!(
        endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender),
        soroban_sdk::vec![env, 356u64]
    );
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &356u64), Some(hash));
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_inbound_rejects_beyond_upper_bound_when_inbound_nonce_nonzero() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    context.set_inbound_nonce(&receiver, src_eid, &sender, 100);

    let hash = BytesN::from_array(env, &[0xabu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 357u64, &hash)
    });
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_inbound_rejects_reverify_when_nonce_leq_inbound_and_payload_missing() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Force inbound_nonce to 1 without storing any payload hashes.
    context.set_inbound_nonce(&receiver, src_eid, &sender, 1);

    let hash = BytesN::from_array(env, &[0xabu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 1, &hash)
    });
}

#[test]
fn test_inbound_allows_reverify_when_nonce_leq_inbound_and_payload_exists() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    let old_hash = BytesN::from_array(env, &[0xabu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_payload_hash(env, &receiver, src_eid, &sender, 1u64, &old_hash);
        storage::EndpointStorage::set_inbound_nonce(env, &receiver, src_eid, &sender, &1u64);
    });
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &1u64), Some(old_hash));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);

    let new_hash = BytesN::from_array(env, &[0xcdu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 1u64, &new_hash)
    });
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &1u64), Some(new_hash));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}
