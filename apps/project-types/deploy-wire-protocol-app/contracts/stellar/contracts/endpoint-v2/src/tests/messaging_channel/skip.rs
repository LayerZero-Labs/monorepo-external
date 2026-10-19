use soroban_sdk::{testutils::Address as _, Address, BytesN};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError, events::InboundNonceSkipped, storage, tests::endpoint_setup::setup,
    tests::endpoint_setup::TestSetup,
};

fn skip_with_auth(
    context: &TestSetup,
    caller: &Address,
    receiver: &Address,
    src_eid: u32,
    sender: &BytesN<32>,
    nonce: u64,
) {
    context.mock_auth(caller, "skip", (caller, receiver, &src_eid, sender, &nonce));
    context.endpoint_client.skip(caller, receiver, &src_eid, sender, &nonce);
}

// Authorization (receiver or delegate(receiver) must authorize)
#[test]
fn test_skip_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let unauthorized = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;

    // Unauthorized should fail before require_auth, so no mock_auth is needed.
    let result = endpoint_client.try_skip(&unauthorized, &receiver, &src_eid, &sender, &nonce);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_skip_requires_auth_even_when_caller_is_receiver() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1u64;

    // No mock_auth here: require_oapp_auth passes the (caller == receiver) check,
    // then panics at caller.require_auth().
    endpoint_client.skip(&receiver, &receiver, &src_eid, &sender, &nonce);
}

// Successful skip updates inbound nonce and emits InboundNonceSkipped
#[test]
fn test_skip_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;

    // Initially, inbound nonce should be 0.
    let initial_nonce = endpoint_client.inbound_nonce(&receiver, &src_eid, &sender);
    assert_eq!(initial_nonce, 0);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());

    // Skip nonce 1 (expected nonce is initial_nonce + 1 = 1).
    skip_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce);

    // Verify InboundNonceSkipped event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        InboundNonceSkipped { src_eid, sender: sender.clone(), receiver: receiver.clone(), nonce },
    );

    // Verify inbound nonce reflects the skip via public interface.
    let updated_nonce = endpoint_client.inbound_nonce(&receiver, &src_eid, &sender);
    assert_eq!(updated_nonce, nonce);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

// Multiple sequential skips update to the latest nonce
#[test]
fn test_skip_multiple_nonces() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Skip nonce 1.
    let nonce1 = 1;
    skip_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce1);

    // Skip nonce 2.
    let nonce2 = 2;
    skip_with_auth(&context, &receiver, &receiver, src_eid, &sender, nonce2);

    // Verify inbound nonce reflects the latest skip.
    let updated_nonce = endpoint_client.inbound_nonce(&receiver, &src_eid, &sender);
    assert_eq!(updated_nonce, nonce2);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

// Delegate authorization (delegate(receiver) is allowed)
#[test]
fn test_skip_with_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let delegate = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;

    // Set delegate for receiver.
    env.as_contract(&endpoint_client.address, || storage::EndpointStorage::set_delegate(env, &receiver, &delegate));

    // Delegate can skip on behalf of receiver.
    skip_with_auth(&context, &delegate, &receiver, src_eid, &sender, nonce);

    // Verify InboundNonceSkipped event was emitted.
    assert_eq_event(
        env,
        &endpoint_client.address,
        InboundNonceSkipped { src_eid, sender: sender.clone(), receiver: receiver.clone(), nonce },
    );

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), nonce);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

// Path isolation (receiver/src_eid/sender are isolated)
#[test]
fn test_skip_different_paths() {
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

    // Skip for different receivers.
    skip_with_auth(&context, &receiver1, &receiver1, src_eid1, &sender1, nonce);
    skip_with_auth(&context, &receiver2, &receiver2, src_eid1, &sender1, nonce);

    // Skip for different src_eids.
    skip_with_auth(&context, &receiver1, &receiver1, src_eid2, &sender1, nonce);

    // Skip for different senders.
    skip_with_auth(&context, &receiver1, &receiver1, src_eid1, &sender2, nonce);

    // Verify all paths have independent inbound nonces.
    assert_eq!(endpoint_client.inbound_nonce(&receiver1, &src_eid1, &sender1), nonce);
    assert_eq!(endpoint_client.inbound_nonce(&receiver2, &src_eid1, &sender1), nonce);
    assert_eq!(endpoint_client.inbound_nonce(&receiver1, &src_eid2, &sender1), nonce);
    assert_eq!(endpoint_client.inbound_nonce(&receiver1, &src_eid1, &sender2), nonce);
}

// Invalid nonce rejection (must match expected nonce)
#[test]
fn test_skip_invalid_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Expected nonce is 1; skipping 2 should fail.
    let invalid_nonce = 2u64;

    context.mock_auth(&receiver, "skip", (&receiver, &receiver, &src_eid, &sender, &invalid_nonce));
    let result = endpoint_client.try_skip(&receiver, &receiver, &src_eid, &sender, &invalid_nonce);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidNonce.into());
}

// Next nonce is derived from inbound_nonce (includes verified payload hashes)
#[test]
fn test_skip_next_nonce_accounts_for_verified_payload_hashes() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Simulate a verified message at nonce 1.
    let payload_hash_1 = BytesN::from_array(env, &[0xabu8; 32]);
    context.inbound_as_verified(&receiver, src_eid, &sender, 1, &payload_hash_1);

    // Now inbound_nonce is 1, so the next nonce to skip must be 2 (not 1).
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);

    context.mock_auth(&receiver, "skip", (&receiver, &receiver, &src_eid, &sender, &1u64));
    let result = endpoint_client.try_skip(&receiver, &receiver, &src_eid, &sender, &1);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidNonce.into());

    // Skipping 2 should succeed and advance inbound nonce to 2.
    skip_with_auth(&context, &receiver, &receiver, src_eid, &sender, 2);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());

    // skip() does not clear any existing payload hashes.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &1), Some(payload_hash_1));
}

// Skipping a missing nonce can "close the gap" and advance inbound_nonce
#[test]
fn test_skip_closes_gap_and_advances_inbound_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Only nonce 2 is verified, so inbound_nonce is still 0 (there is a gap at nonce 1).
    let payload_hash_2 = BytesN::from_array(env, &[0xcdu8; 32]);
    context.inbound_as_verified(&receiver, src_eid, &sender, 2, &payload_hash_2);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);

    // Skip nonce 1 to close the gap. This should allow inbound_nonce to advance to 2.
    skip_with_auth(&context, &receiver, &receiver, src_eid, &sender, 1);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());

    // Payload hash at nonce 2 remains intact.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2), Some(payload_hash_2));
}

// Skipping a missing nonce can close *part* of the gap while leaving later gaps pending.
#[test]
fn test_skip_closes_gap_but_pending_inbound_nonces_not_empty() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Verify nonce 2 and 4 out-of-order. inbound_nonce stays 0 because nonce 1 is missing, and
    // pending list contains [2, 4] (gap at 1 and 3).
    let payload_hash_2 = BytesN::from_array(env, &[0x11u8; 32]);
    let payload_hash_4 = BytesN::from_array(env, &[0x22u8; 32]);
    context.inbound_as_verified(&receiver, src_eid, &sender, 2, &payload_hash_2);
    context.inbound_as_verified(&receiver, src_eid, &sender, 4, &payload_hash_4);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);

    // Skip nonce 1 closes the first gap and drains consecutive pending nonces up to 2,
    // but nonce 4 remains pending because nonce 3 is still missing.
    skip_with_auth(&context, &receiver, &receiver, src_eid, &sender, 1);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 2);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), soroban_sdk::vec![env, 4u64]);

    // Payload hashes remain intact.
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2), Some(payload_hash_2));
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &4), Some(payload_hash_4));
}

// Repeated skip of the same nonce is rejected
#[test]
fn test_skip_rejects_repeated_same_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    // Skip nonce 1 successfully.
    skip_with_auth(&context, &receiver, &receiver, src_eid, &sender, 1);
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 1);

    // Skipping nonce 1 again should fail since the next expected nonce is now 2.
    context.mock_auth(&receiver, "skip", (&receiver, &receiver, &src_eid, &sender, &1u64));
    let result = endpoint_client.try_skip(&receiver, &receiver, &src_eid, &sender, &1);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidNonce.into());
}
