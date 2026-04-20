use soroban_sdk::{testutils::Address as _, BytesN};

use crate::{storage, tests::endpoint_setup::setup, tests::endpoint_setup::TestSetup, Origin};

fn skip_with_auth(context: &TestSetup, receiver: &soroban_sdk::Address, src_eid: u32, sender: &BytesN<32>, nonce: u64) {
    // `skip` requires authorization from `caller` (the receiver or its delegate).
    context.mock_auth(receiver, "skip", (receiver, receiver, &src_eid, sender, &nonce));
    context.endpoint_client.skip(receiver, receiver, &src_eid, sender, &nonce);
}

fn verify_with_auth(
    context: &TestSetup,
    receive_lib: &soroban_sdk::Address,
    origin: &Origin,
    receiver: &soroban_sdk::Address,
    payload_hash: &BytesN<32>,
) {
    // `verify` requires authorization from `receive_lib`.
    context.mock_auth(receive_lib, "verify", (receive_lib, origin, receiver, payload_hash));
    context.endpoint_client.verify(receive_lib, origin, receiver, payload_hash);
}

// New path (inbound nonce == 0) => verifiable when origin.nonce is within (0, 256]
#[test]
fn test_verifiable_new_path_nonce_1_true() {
    let context = setup();
    let endpoint_client = &context.endpoint_client;
    let receiver = soroban_sdk::Address::generate(&context.env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(&context.env, &[1u8; 32]);
    let origin = Origin { src_eid, sender, nonce: 1 };

    // For a new path (inbound nonce is 0), nonce 1 should be verifiable.
    let result = endpoint_client.verifiable(&origin, &receiver);
    assert!(result);
}

// Established path => verifiable when origin.nonce is in (inbound_nonce, inbound_nonce + 256]
#[test]
fn test_verifiable_after_skip_nonce_gt_inbound_nonce_true() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let receiver = soroban_sdk::Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Establish the path by skipping nonce 1.
    skip_with_auth(&context, &receiver, src_eid, &sender, 1);

    // Now inbound_nonce = 1, nonce 2 should be verifiable.
    let origin = Origin { src_eid, sender, nonce: 2 };
    let result = endpoint_client.verifiable(&origin, &receiver);
    assert!(result);
}

// Nonce <= inbound_nonce is still verifiable when an inbound payload hash exists
#[test]
fn test_verifiable_true_when_nonce_leq_inbound_nonce_but_payload_hash_exists() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = soroban_sdk::Address::generate(env);

    // Setup receive library (needed to store a payload hash via verify).
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Establish the path by skipping nonce 1 (inbound_nonce becomes 1).
    skip_with_auth(&context, &receiver, src_eid, &sender, 1);

    // Verify nonce 2 (allowed because 2 > inbound_nonce 1) which stores inbound payload hash for nonce 2.
    let origin2 = Origin { src_eid, sender: sender.clone(), nonce: 2u64 };
    let payload_hash2 = BytesN::from_array(env, &[0x33u8; 32]);
    verify_with_auth(&context, &receive_lib, &origin2, &receiver, &payload_hash2);

    // Advance inbound_nonce to 3 while keeping payload hash for 2 (skip doesn't clear payload hashes).
    skip_with_auth(&context, &receiver, src_eid, &sender, 3);

    // Sanity: inbound nonce was advanced, and the payload hash for nonce 2 still exists.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);
    assert!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2u64).is_some());

    // Now nonce 2 <= inbound_nonce 3, but payload hash exists -> verifiable should be true.
    assert!(endpoint_client.verifiable(&origin2, &receiver));
}

// Boundary case (nonce == inbound_nonce)
#[test]
fn test_verifiable_nonce_eq_inbound_nonce_false_without_payload_hash() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = soroban_sdk::Address::generate(env);

    // Advance inbound nonce to 2 without storing any payload hashes at nonce 2.
    skip_with_auth(&context, &receiver, src_eid, &sender, 1);
    skip_with_auth(&context, &receiver, src_eid, &sender, 2);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);

    // nonce == inbound_nonce and payload hash missing -> verifiable should be false.
    let origin2 = Origin { src_eid, sender: sender.clone(), nonce: 2u64 };
    assert!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2u64).is_none());
    assert!(!endpoint_client.verifiable(&origin2, &receiver));
}

#[test]
fn test_verifiable_upper_bound_is_enforced() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = soroban_sdk::Address::generate(env);

    // For a new path inbound_nonce=0: 256 is allowed, 257 is not.
    let origin_256 = Origin { src_eid, sender: sender.clone(), nonce: 256u64 };
    let origin_257 = Origin { src_eid, sender, nonce: 257u64 };
    assert!(endpoint_client.verifiable(&origin_256, &receiver));
    assert!(!endpoint_client.verifiable(&origin_257, &receiver));
}

#[test]
fn test_verifiable_upper_bound_is_enforced_when_inbound_nonce_nonzero() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = soroban_sdk::Address::generate(env);

    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_nonce(env, &receiver, src_eid, &sender, &100u64)
    });

    let ok = Origin { src_eid, sender: sender.clone(), nonce: 356u64 }; // 100 + 256
    let too_far = Origin { src_eid, sender, nonce: 357u64 };
    assert!(endpoint_client.verifiable(&ok, &receiver));
    assert!(!endpoint_client.verifiable(&too_far, &receiver));
}


#[test]
fn test_verifiable_true_when_payload_hash_exists_even_if_nonce_outside_window() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = soroban_sdk::Address::generate(env);

    // NOTE: This state should be unreachable in normal execution flows.
    //
    // In production, payload hashes are written by `verify()` -> `inbound()`. For *new* nonces
    // (`nonce > inbound_nonce`), `inbound()` calls `insert_and_drain_pending_nonces()` which enforces
    // the pending window bound (`nonce <= inbound_nonce + 256`).
    //
    // Therefore, with `inbound_nonce == 0`, a payload hash at a "far" nonce (e.g. 999) cannot be
    // created through valid contract calls (it would fail `verifiable()` and/or the pending window
    // bound on insertion).
    //
    // We write storage directly here to simulate corrupted/invalid state and to ensure `verifiable()`
    // preserves its OR semantics: if a payload hash exists for a nonce, `verifiable()` must return
    // true even when the nonce is outside the pending window.

    // Choose a nonce that is clearly outside the pending window when inbound_nonce == 0.
    let far_nonce = 999u64;

    // Write payload hash directly to storage to exercise the OR branch:
    // `EndpointStorage::has_inbound_payload_hash(...) == true` should make verifiable() return true,
    // even if the nonce is outside (inbound_nonce, inbound_nonce + 256].
    let payload_hash = BytesN::from_array(env, &[0x42u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_payload_hash(env, &receiver, src_eid, &sender, far_nonce, &payload_hash)
    });

    let origin_far = Origin { src_eid, sender, nonce: far_nonce };
    assert!(endpoint_client.verifiable(&origin_far, &receiver));
}
