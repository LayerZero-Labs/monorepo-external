use soroban_sdk::{testutils::Address as _, Address, BytesN};
use utils::testing_utils::assert_eq_event;

use crate::{
    endpoint_v2::EndpointV2, errors::EndpointError, events::PacketNilified, storage, tests::endpoint_setup::setup,
    tests::endpoint_setup::TestSetup,
};

// Helpers
fn nil_hash(context: &TestSetup) -> BytesN<32> {
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    env.as_contract(&endpoint_client.address, || EndpointV2::nil_payload_hash_for_test(env))
}

fn nilify_with_auth(
    context: &TestSetup,
    caller: &Address,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
    payload_hash: &Option<BytesN<32>>,
) {
    context.mock_auth(caller, "nilify", (caller, receiver, &src_eid, sender, &nonce, payload_hash));
    context.endpoint_client.nilify(caller, receiver, &src_eid, sender, &nonce, payload_hash);
}

fn try_nilify_with_auth(
    context: &TestSetup,
    caller: &Address,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
    payload_hash: &Option<BytesN<32>>,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_auth(caller, "nilify", (caller, receiver, &src_eid, sender, &nonce, payload_hash));
    context.endpoint_client.try_nilify(caller, receiver, &src_eid, sender, &nonce, payload_hash)
}

// Authorization (receiver or delegate(receiver) must authorize)
#[test]
fn test_nilify_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let unauthorized = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;

    // Unauthorized should fail before require_auth, so no mock_auth is needed.
    let result = endpoint_client.try_nilify(&unauthorized, &receiver, &src_eid, &sender, &nonce, &None);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_nilify_requires_auth_even_when_caller_is_receiver() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;

    // No mock_auth here: require_oapp_auth passes the (caller == receiver) check,
    // then panics at caller.require_auth().
    endpoint_client.nilify(&receiver, &receiver, &src_eid, &sender, &nonce, &None);
}

// Successful nilify with stored (verified) payload hash (state update + event emission)
#[test]
fn test_nilify_success_with_stored_payload() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // Store a payload hash first.
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce, &payload_hash);

    // Verify payload hash is stored.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash.clone()));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);

    // Nilify the payload.
    let payload_hash_opt = Some(payload_hash.clone());
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &payload_hash_opt);

    // Verify PacketNilified event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        PacketNilified {
            src_eid,
            sender: sender.clone(),
            receiver: receiver.clone(),
            nonce,
            payload_hash: Some(payload_hash.clone()),
        },
    );

    // Verify payload hash was replaced with nil hash.
    let nilified_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    let expected_nil_hash = nil_hash(&context);
    assert_eq!(nilified_hash, Some(expected_nil_hash));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);
}

// Successful nilify with None (no existing payload hash) when nonce > inbound_nonce
#[test]
fn test_nilify_success_with_empty_payload() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 2;

    // Set inbound nonce to 1 so nonce 2 is the next expected nonce.
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_nonce(env, &receiver, src_eid, &sender, &1)
    });

    // Nilify with None.
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &None);

    // Verify PacketNilified event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        PacketNilified { src_eid, sender: sender.clone(), receiver: receiver.clone(), nonce, payload_hash: None },
    );

    // Verify payload hash was set to nil hash.
    let nilified_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    let expected_nil_hash = nil_hash(&context);
    assert_eq!(nilified_hash, Some(expected_nil_hash));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
}

// Nilify with None counts toward `inbound_nonce` advancement (via pending-nonce draining).
#[test]
fn test_nilify_with_none_advances_inbound_nonce_without_changing_payload_hashes() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Initial state.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());

    // Nilify nonce 1 with None (non-verified nonce).
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, 1, &None);

    // Nilify writes a payload hash, so inbound_nonce can now advance to 1.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
fn test_nilify_closes_gap_and_drains_pending_nonces() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Force inbound nonce to 1 and create a gap by verifying nonce 3 first.
    context.set_inbound_nonce(&receiver, src_eid, &sender, 1);
    let payload_hash_3 = BytesN::from_array(env, &[0x33u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 3u64, &payload_hash_3)
    });

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);
    assert_eq!(
        endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender),
        soroban_sdk::vec![env, 3u64]
    );

    // Nilify nonce 2 with None closes the gap and should drain pending to advance inbound nonce to 3.
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, 2u64, &None);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
    assert_eq!(
        endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2u64),
        Some(nil_hash(&context))
    );
    assert_eq!(
        endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &3u64),
        Some(payload_hash_3)
    );
}

// Nilify is allowed when nonce <= inbound_nonce if an `inbound_payload_hash` exists
#[test]
fn test_nilify_allows_when_nonce_is_checkpointed_if_payload_exists() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 5u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // Advance inbound nonce past the target nonce and store a payload hash at nonce 5.
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_nonce(env, &receiver, src_eid, &sender, &10);
        storage::EndpointStorage::set_inbound_payload_hash(env, &receiver, src_eid, &sender, nonce, &payload_hash);
    });
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 10);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash.clone()));

    // Even though nonce <= inbound_nonce, this should succeed because a payload hash exists.
    let payload_hash_opt = Some(payload_hash.clone());
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &payload_hash_opt);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(nil_hash(&context)));
}

// Nilify is idempotent if the caller passes the current stored payload hash (including nil hash)
#[test]
fn test_nilify_allows_repeated_call_when_already_nilified() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // First nilify: verified payload hash -> nil hash.
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce, &payload_hash);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);
    let payload_hash_opt = Some(payload_hash);
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &payload_hash_opt);

    let nil = nil_hash(&context);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(nil.clone()));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);

    // Second nilify: passing the current stored nil hash should succeed.
    let nil_opt = Some(nil.clone());
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &nil_opt);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(nil));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);
}

// Delegate authorization (delegate(receiver) is allowed)
#[test]
fn test_nilify_with_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let delegate = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;
    let payload_hash = BytesN::from_array(env, &[0xcdu8; 32]);

    // Set delegate for receiver.
    env.as_contract(&endpoint_client.address, || storage::EndpointStorage::set_delegate(env, &receiver, &delegate));

    // Store a payload hash first.
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce, &payload_hash);

    // Delegate can nilify on behalf of receiver.
    let payload_hash_opt = Some(payload_hash.clone());
    nilify_with_auth(&context, &delegate, &receiver, src_eid, &sender, nonce, &payload_hash_opt);

    // Verify PacketNilified event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        PacketNilified {
            src_eid,
            sender: sender.clone(),
            receiver: receiver.clone(),
            nonce,
            payload_hash: Some(payload_hash.clone()),
        },
    );

    // Verify payload hash was replaced with nil hash.
    let nilified_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    let expected_nil_hash = nil_hash(&context);
    assert_eq!(nilified_hash, Some(expected_nil_hash));
}

// Nilify affects only the targeted nonce (multiple nonces stay independent)
#[test]
fn test_nilify_multiple_payloads() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let payload_hash1 = BytesN::from_array(env, &[0xabu8; 32]);
    let payload_hash2 = BytesN::from_array(env, &[0xcdu8; 32]);
    let nonce1 = 1;
    let nonce2 = 2;

    // Store multiple payload hashes.
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce1, &payload_hash1);
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce2, &payload_hash2);

    // Nilify first payload.
    let payload_hash1_opt = Some(payload_hash1.clone());
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce1, &payload_hash1_opt);

    // Nilify second payload.
    let payload_hash2_opt = Some(payload_hash2.clone());
    nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce2, &payload_hash2_opt);

    // Verify both payload hashes were replaced with nil hash.
    let expected_nil_hash = nil_hash(&context);

    let nilified_hash1 = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce1);
    let nilified_hash2 = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce2);

    assert_eq!(nilified_hash1, Some(expected_nil_hash.clone()));
    assert_eq!(nilified_hash2, Some(expected_nil_hash));
}

// Path isolation (receiver/src_eid/sender are isolated)
#[test]
fn test_nilify_different_paths() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver1 = Address::generate(env);
    let receiver2 = Address::generate(env);
    let src_eid1 = 2;
    let src_eid2 = 3;
    let sender1 = BytesN::from_array(env, &[1u8; 32]);
    let sender2 = BytesN::from_array(env, &[2u8; 32]);
    let nonce = 1;
    let payload_hash = BytesN::from_array(env, &[0xefu8; 32]);

    // Store payload hashes for different paths.
    context.inbound_as_verified(&receiver1, src_eid1, &sender1, nonce, &payload_hash);
    context.inbound_as_verified(&receiver2, src_eid1, &sender1, nonce, &payload_hash);
    context.inbound_as_verified(&receiver1, src_eid2, &sender1, nonce, &payload_hash);
    context.inbound_as_verified(&receiver1, src_eid1, &sender2, nonce, &payload_hash);

    // Nilify for different receivers.
    let payload_hash_opt = Some(payload_hash.clone());
    nilify_with_auth(&context, &receiver1, &receiver1, src_eid1, &sender1, nonce, &payload_hash_opt);

    nilify_with_auth(&context, &receiver2, &receiver2, src_eid1, &sender1, nonce, &payload_hash_opt);

    // Nilify for different src_eids.
    nilify_with_auth(&context, &receiver1, &receiver1, src_eid2, &sender1, nonce, &payload_hash_opt);

    // Nilify for different senders.
    nilify_with_auth(&context, &receiver1, &receiver1, src_eid1, &sender2, nonce, &payload_hash_opt);

    // Verify all paths have been nilified independently.
    let expected_nil_hash = nil_hash(&context);

    let nilified_hash1 = endpoint_client.inbound_payload_hash(&receiver1, &src_eid1, &sender1, &nonce);
    let nilified_hash2 = endpoint_client.inbound_payload_hash(&receiver2, &src_eid1, &sender1, &nonce);
    let nilified_hash3 = endpoint_client.inbound_payload_hash(&receiver1, &src_eid2, &sender1, &nonce);
    let nilified_hash4 = endpoint_client.inbound_payload_hash(&receiver1, &src_eid1, &sender2, &nonce);

    assert_eq!(nilified_hash1, Some(expected_nil_hash.clone()));
    assert_eq!(nilified_hash2, Some(expected_nil_hash.clone()));
    assert_eq!(nilified_hash3, Some(expected_nil_hash.clone()));
    assert_eq!(nilified_hash4, Some(expected_nil_hash));
}

// Failure if payload_hash does not match the stored value
#[test]
fn test_nilify_payload_hash_not_found_when_mismatch() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);
    let wrong_payload_hash = BytesN::from_array(env, &[0x11u8; 32]);

    // Store a payload hash first.
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce, &payload_hash);

    // Attempt nilify with wrong expected hash.
    let wrong_payload_hash_opt = Some(wrong_payload_hash.clone());
    let result = try_nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &wrong_payload_hash_opt);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PayloadHashNotFound.into());
}

#[test]
fn test_nilify_payload_hash_not_found_when_expected_some_but_storage_none() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let expected_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // Storage has no payload hash for (receiver, src_eid, sender, nonce).
    let expected_hash_opt = Some(expected_hash);
    let result = try_nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &expected_hash_opt);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PayloadHashNotFound.into());
}

#[test]
fn test_nilify_payload_hash_not_found_when_none_but_payload_exists() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // Store a payload hash first.
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce, &payload_hash);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash));

    // Calling nilify with None should fail, because payload_hash must match the stored value.
    let result = try_nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &None);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PayloadHashNotFound.into());
}

// Failure when nonce is already checkpointed and there is no stored payload hash
#[test]
fn test_nilify_invalid_nonce_when_already_checkpointed_without_payload() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;

    // Set inbound nonce to 1 and ensure there is NO payload for nonce 1.
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_nonce(env, &receiver, src_eid, &sender, &1)
    });

    let result = try_nilify_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &None);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidNonce.into());
}
