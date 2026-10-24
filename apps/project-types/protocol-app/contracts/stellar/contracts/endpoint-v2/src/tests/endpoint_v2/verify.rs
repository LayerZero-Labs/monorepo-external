use soroban_sdk::{vec, Bytes, BytesN, Env};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError,
    events::PacketVerified,
    tests::{
        endpoint_setup::setup,
        mock::{MockReceiver, MockReceiverReject},
    },
    util::build_payload,
    util::keccak256,
    Origin,
};

// Helpers
fn default_payload_hash(env: &Env) -> BytesN<32> {
    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let payload = build_payload(env, &guid, &message);
    keccak256(env, &payload)
}

// Happy Path
#[test]
fn test_verify_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Create payload hash
    let payload_hash = default_payload_hash(env);

    let origin = Origin { src_eid, sender: sender.clone(), nonce };

    // Verify initial state - inbound payload hash should not exist
    let initial_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(initial_hash, None, "Initial inbound payload hash should be None");

    // Mock auth for receive_lib
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin, &receiver, &payload_hash));

    endpoint_client.verify(&receive_lib, &origin, &receiver, &payload_hash);

    // Verify PacketVerified event was published
    assert_eq_event(
        env,
        &endpoint_client.address,
        PacketVerified { origin: origin.clone(), receiver: receiver.clone(), payload_hash: payload_hash.clone() },
    );

    // Verify inbound payload hash was stored via public interface
    let stored_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(stored_hash, Some(payload_hash.clone()));
}

// Storage & Nonce Behavior
#[test]
fn test_verify_overwrites_payload_hash_for_same_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    let origin = Origin { src_eid, sender: sender.clone(), nonce };

    // Verify once
    let payload_hash1 = BytesN::from_array(env, &[0x11u8; 32]);
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin, &receiver, &payload_hash1));
    endpoint_client.verify(&receive_lib, &origin, &receiver, &payload_hash1);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash1.clone()));

    // Verify again with a different payload hash (current logic allows overwriting)
    let payload_hash2 = BytesN::from_array(env, &[0x22u8; 32]);
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin, &receiver, &payload_hash2));
    endpoint_client.verify(&receive_lib, &origin, &receiver, &payload_hash2);
    assert_eq!(endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce), Some(payload_hash2));
}

#[test]
fn test_verify_multiple_nonces() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Verify nonce 1
    let payload_hash1 = BytesN::from_array(env, &[1u8; 32]);
    let origin1 = Origin { src_eid, sender: sender.clone(), nonce: 1 };
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin1, &receiver, &payload_hash1));
    endpoint_client.verify(&receive_lib, &origin1, &receiver, &payload_hash1);

    // Verify nonce 2
    let payload_hash2 = BytesN::from_array(env, &[2u8; 32]);
    let origin2 = Origin { src_eid, sender: sender.clone(), nonce: 2 };
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin2, &receiver, &payload_hash2));
    endpoint_client.verify(&receive_lib, &origin2, &receiver, &payload_hash2);

    // Verify both payload hashes were stored
    let stored_hash1 = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &1);
    let stored_hash2 = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &2);
    assert_eq!(stored_hash1, Some(payload_hash1));
    assert_eq!(stored_hash2, Some(payload_hash2));
}

// Authorization
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_verify_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Create payload hash
    let payload_hash = default_payload_hash(env);

    let origin = Origin { src_eid, sender, nonce };

    // Don't mock auth for receive_lib - should panic with Auth error
    endpoint_client.verify(&receive_lib, &origin, &receiver, &payload_hash);
}

// Receive Library Validation
#[test]
fn test_verify_invalid_receive_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    // Setup valid receive library and set as default (so get_receive_library succeeds)
    let _valid_receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Create invalid receive library (different from configured one, not registered, no timeout)
    // is_valid_receive_library will call get_receive_library (succeeds with default),
    // then check actual_lib != expected_lib (true), then check timeout (None), so returns false
    let invalid_receive_lib = context.setup_mock_receive_lib(vec![env, src_eid]);
    // Don't register or set as default - this makes it invalid

    // Create payload hash
    let payload_hash = default_payload_hash(env);

    let origin = Origin { src_eid, sender, nonce };

    // Mock auth for invalid receive library
    context.mock_auth(&invalid_receive_lib, "verify", (&invalid_receive_lib, &origin, &receiver, &payload_hash));

    let result = endpoint_client.try_verify(&invalid_receive_lib, &origin, &receiver, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidReceiveLibrary.into());
}

// Payload Hash Validation
#[test]
fn test_verify_invalid_payload_hash_empty() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());
    let nonce = 1u64;

    // Setup receive library
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Empty payload hash is not allowed
    let empty_hash = BytesN::from_array(env, &[0u8; 32]);
    let origin = Origin { src_eid, sender, nonce };

    // Mock auth for receive_lib
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin, &receiver, &empty_hash));

    let result = endpoint_client.try_verify(&receive_lib, &origin, &receiver, &empty_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidPayloadHash.into());
}

// Path Validation
#[test]
fn test_verify_path_not_initializable() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    // Use MockReceiverReject which rejects initialization (returns false from allow_initialize_path)
    let receiver = env.register(MockReceiverReject, ());
    let nonce = 1u64;

    // Setup receive library and set as default (so library validation passes)
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Create payload hash
    let payload_hash = default_payload_hash(env);

    let origin = Origin { src_eid, sender, nonce };

    // Mock auth for receive_lib
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin, &receiver, &payload_hash));

    // Library validation passes (receive_lib matches default)
    // initializable checks: inbound_nonce == 0, and receiver.allow_initialize_path(origin) == false
    // So initializable returns false, should panic with PathNotInitializable error
    let result = endpoint_client.try_verify(&receive_lib, &origin, &receiver, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PathNotInitializable.into());
}

#[test]
fn test_verify_path_not_verifiable() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let receiver = env.register(MockReceiver, ());

    // Setup receive library and set as default (so library validation passes)
    let receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Skip nonce 1 to advance inbound_nonce to 1 (so initializable passes: inbound_nonce > 0)
    context.mock_auth(&receiver, "skip", (&receiver, &receiver, &src_eid, &sender, &1u64));
    endpoint_client.skip(&receiver, &receiver, &src_eid, &sender, &1);

    // Create payload hash
    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let payload = build_payload(env, &guid, &message);
    let payload_hash = keccak256(env, &payload);

    // Try to verify nonce 1, but inbound_nonce is already 1, so nonce 1 is not verifiable
    // verifiable checks: nonce > inbound_nonce (1 > 1 is false) OR has payload hash (false)
    let origin = Origin { src_eid, sender, nonce: 1 };

    // Mock auth for receive_lib
    context.mock_auth(&receive_lib, "verify", (&receive_lib, &origin, &receiver, &payload_hash));

    // Library validation passes, initializable passes (inbound_nonce > 0)
    // verifiable fails (nonce <= inbound_nonce and no payload hash), should panic with PathNotVerifiable error
    let result = endpoint_client.try_verify(&receive_lib, &origin, &receiver, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::PathNotVerifiable.into());
}
