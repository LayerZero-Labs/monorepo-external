use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN};

use crate::{
    endpoint_v2::EndpointV2,
    storage,
    tests::endpoint_setup::{setup, TestSetup},
};

// Helpers
fn inbound_as_verified_from_payload(
    context: &TestSetup,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
    payload: &Bytes,
) -> BytesN<32> {
    let env = &context.env;
    let payload_hash = BytesN::from_array(env, &env.crypto().keccak256(payload).to_array());
    context.inbound_as_verified(receiver, src_eid, sender, nonce, &payload_hash);
    payload_hash
}

fn clear_payload(
    context: &TestSetup,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
    payload: &Bytes,
) {
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::clear_payload_for_test(env, receiver, src_eid, sender, nonce, payload)
    });
}

// Internal clear_payload() removes verified payload and does not change inbound nonce
#[test]
fn test_clear_payload_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload = Bytes::from_array(env, &[0xaa, 0xbb, 0xcc]);

    let payload_hash = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, nonce, &payload);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash.clone()));

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), nonce);

    clear_payload(&context, &receiver, src_eid, &sender, nonce, &payload);

    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), None);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), nonce);
}

#[test]
fn test_clear_payload_keeps_other_payload_hashes_intact() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    let payload1 = Bytes::from_array(env, &[0x01]);
    let payload2 = Bytes::from_array(env, &[0x02]);
    let payload3 = Bytes::from_array(env, &[0x03]);

    let hash1 = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 1, &payload1);
    let hash2 = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 2, &payload2);
    let hash3 = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 3, &payload3);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);

    // Clearing nonce 3 removes only nonce 3's payload hash.
    clear_payload(&context, &receiver, src_eid, &sender, 3, &payload3);

    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &3), None);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &1), Some(hash1));
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2), Some(hash2));
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);
    let _ = hash3; // hash3 is only used to ensure it was computed and stored for nonce 3.
}

#[test]
fn test_clear_payload_does_not_change_pending_inbound_nonces() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Verify 1 and 2 consecutively, then verify 4 out-of-order.
    // This produces: inbound_nonce = 2, pending_inbound_nonces = [4].
    let payload1 = Bytes::from_array(env, &[0x01]);
    let payload2 = Bytes::from_array(env, &[0x02]);
    let payload4 = Bytes::from_array(env, &[0x04]);

    let hash1 = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 1, &payload1);
    let hash2 = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 2, &payload2);
    let hash4 = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 4, &payload4);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 4u64]);

    // Clear nonce 2. This must not affect pending nonces (which are > inbound_nonce).
    clear_payload(&context, &receiver, src_eid, &sender, 2, &payload2);

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 4u64]);

    // Only nonce 2 is cleared; others remain.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2), None);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &1), Some(hash1));
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &4), Some(hash4));
    let _ = hash2; // hash2 is only used to ensure it was computed and stored for nonce 2.
}

// Clearing a nonce <= inbound nonce does not update inbound nonce
#[test]
fn test_clear_payload_does_not_update_inbound_nonce_when_nonce_is_not_greater() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Pretend we already advanced inbound nonce to 5.
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_nonce(env, &receiver, src_eid, &sender, &5u64)
    });
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 5);

    // Store a payload hash at nonce 3, then clear it.
    let nonce = 3u64;
    let payload = Bytes::from_array(env, &[0xaa, 0xbb, 0xcc]);
    let payload_hash = BytesN::from_array(env, &env.crypto().keccak256(&payload).to_array());
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_payload_hash(env, &receiver, src_eid, &sender, nonce, &payload_hash)
    });
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash.clone()));

    clear_payload(&context, &receiver, src_eid, &sender, nonce, &payload);

    // Clearing an older nonce should not mutate inbound_nonce.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 5);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), None);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // EndpointError::PayloadHashNotFound
fn test_clear_payload_payload_hash_not_found_when_nonce_is_checkpointed_but_missing() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // nonce <= inbound_nonce, so clear_payload will NOT run the "has_payload for all intermediate nonces" check.
    // It should fail at the payload hash check instead.
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_nonce(env, &receiver, src_eid, &sender, &5u64)
    });
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 5);

    // No payload hash is stored for nonce 3.
    let nonce = 3u64;
    let payload = Bytes::from_array(env, &[0xaa, 0xbb, 0xcc]);
    clear_payload(&context, &receiver, src_eid, &sender, nonce, &payload);
}

#[test]
#[should_panic(expected = "Error(Contract, #20)")] // EndpointError::PayloadHashNotFound
fn test_clear_payload_wrong_payload() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;

    let payload = Bytes::from_array(env, &[0xaa, 0xbb, 0xcc]);
    let wrong_payload = Bytes::from_array(env, &[0xdd, 0xee, 0xff]);

    let payload_hash = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, nonce, &payload);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash));

    clear_payload(&context, &receiver, src_eid, &sender, nonce, &wrong_payload);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_clear_payload_not_stored() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;
    let payload = Bytes::from_array(env, &[0xaa, 0xbb, 0xcc]);

    clear_payload(&context, &receiver, src_eid, &sender, nonce, &payload);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // EndpointError::InvalidNonce
fn test_clear_payload_missing_intermediate_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Store only nonce 1 and 3, skip nonce 2.
    let payload1 = Bytes::from_array(env, &[0x01]);
    let payload3 = Bytes::from_array(env, &[0x03]);

    let _ = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 1, &payload1);
    let _ = inbound_as_verified_from_payload(&context, &receiver, src_eid, &sender, 3, &payload3);

    // inbound_nonce should be 1 (nonce 2 is missing), and nonce 3 should be pending.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);
    assert_eq!(
        endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender),
        soroban_sdk::vec![env, 3u64]
    );

    // Clearing nonce 1 succeeds.
    clear_payload(&context, &receiver, src_eid, &sender, 1, &payload1);

    // clear_payload does not advance inbound_nonce; it remains 1.
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);

    // Try to clear nonce 3 - should panic because inbound_nonce is still 1 (nonce 3 is out-of-order).
    clear_payload(&context, &receiver, src_eid, &sender, 3, &payload3);
}
