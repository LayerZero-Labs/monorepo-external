use soroban_sdk::{testutils::Address as _, Address, BytesN};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError,
    events::PacketBurnt,
    storage,
    tests::endpoint_setup::{setup, TestSetup},
};

// Helpers
fn burn_with_auth(
    context: &TestSetup,
    caller: &Address,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
    payload_hash: &BytesN<32>,
) {
    context.mock_auth(caller, "burn", (caller, receiver, &src_eid, sender, &nonce, payload_hash));
    context.endpoint_client.burn(caller, receiver, &src_eid, sender, &nonce, payload_hash);
}

fn try_burn_with_auth(
    context: &TestSetup,
    caller: &Address,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
    payload_hash: &BytesN<32>,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_auth(caller, "burn", (caller, receiver, &src_eid, sender, &nonce, payload_hash));
    context.endpoint_client.try_burn(caller, receiver, &src_eid, sender, &nonce, payload_hash)
}

// Authorization (receiver or delegate(receiver) must authorize)
#[test]
fn test_burn_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let unauthorized = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    let result = endpoint_client.try_burn(&unauthorized, &receiver, &src_eid, &sender, &nonce, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_burn_requires_auth_even_when_caller_is_receiver() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // No mock_auth here: require_oapp_auth passes the (caller == receiver) check,
    // then panics at caller.require_auth().
    endpoint_client.burn(&receiver, &receiver, &src_eid, &sender, &nonce, &payload_hash);
}

// Successful burn removes stored payload hash (state update + event emission)
#[test]
fn test_burn_success_with_stored_payload() {
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
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash.clone()));

    // Burn the payload.
    burn_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &payload_hash);

    // Verify PacketBurnt event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        PacketBurnt {
            src_eid,
            sender: sender.clone(),
            receiver: receiver.clone(),
            nonce,
            payload_hash: payload_hash.clone(),
        },
    );

    // Verify payload hash was removed.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), None);
}

// Delegate authorization (delegate(receiver) is allowed)
#[test]
fn test_burn_with_delegate() {
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

    // Delegate can burn on behalf of receiver.
    burn_with_auth(&context, &delegate, &receiver, src_eid, &sender, nonce, &payload_hash);

    // Verify PacketBurnt event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        PacketBurnt {
            src_eid,
            sender: sender.clone(),
            receiver: receiver.clone(),
            nonce,
            payload_hash: payload_hash.clone(),
        },
    );

    // Verify payload hash was removed.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), None);
}

// Burn affects only the targeted nonce (multiple nonces stay independent)
#[test]
fn test_burn_multiple_payloads() {
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

    // Burn first payload.
    burn_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce1, &payload_hash1);

    // Burn second payload.
    burn_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce2, &payload_hash2);

    // Verify both payload hashes were removed.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce1), None);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce2), None);
}

// Path isolation (receiver/src_eid/sender are isolated)
#[test]
fn test_burn_different_paths() {
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

    // Burn for different receivers.
    burn_with_auth(&context, &receiver1, &receiver1, src_eid1, &sender1, nonce, &payload_hash);

    burn_with_auth(&context, &receiver2, &receiver2, src_eid1, &sender1, nonce, &payload_hash);

    // Burn for different src_eids.
    burn_with_auth(&context, &receiver1, &receiver1, src_eid2, &sender1, nonce, &payload_hash);

    // Burn for different senders.
    burn_with_auth(&context, &receiver1, &receiver1, src_eid1, &sender2, nonce, &payload_hash);

    // Verify all paths have been burned independently.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver1, &src_eid1, &sender1, &nonce), None);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver2, &src_eid1, &sender1, &nonce), None);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver1, &src_eid2, &sender1, &nonce), None);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver1, &src_eid1, &sender2, &nonce), None);
}

// Failure if payload_hash does not match the stored value
#[test]
fn test_burn_payload_hash_not_found_when_mismatch() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);
    let wrong_payload_hash = BytesN::from_array(env, &[0x11u8; 32]);

    // Store a payload hash first.
    context.inbound_as_verified(&receiver, src_eid, &sender, nonce, &payload_hash);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash.clone()));

    // Mismatched expected hash should fail.
    let result = try_burn_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &wrong_payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PayloadHashNotFound.into());
}

#[test]
fn test_burn_payload_hash_not_found_when_storage_none() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // Burn must fail without a stored payload hash.
    context.set_inbound_nonce(&receiver, src_eid, &sender, nonce);
    let result = try_burn_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PayloadHashNotFound.into());
}

// Failure when nonce is greater than `inbound_nonce`
#[test]
fn test_burn_invalid_nonce_when_greater_than_inbound_nonce() {
    let context = setup();
    let env = &context.env;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 2u64;
    let payload_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // inbound nonce is 1, trying to burn nonce 2 should fail (even if a payload hash exists).
    context.set_inbound_nonce(&receiver, src_eid, &sender, 1);
    env.as_contract(&context.endpoint_client.address, || {
        storage::EndpointStorage::set_inbound_payload_hash(env, &receiver, src_eid, &sender, nonce, &payload_hash);
    });

    let result = try_burn_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidNonce.into());
}
