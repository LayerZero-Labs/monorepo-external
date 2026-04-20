use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN};

use crate::{tests::endpoint_setup::setup, util::keccak256};

// The compose_queue is None when unset
#[test]
fn test_compose_queue_none_initially() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;

    // Query compose queue before any message is sent
    let result = endpoint_client.compose_queue(&from, &to, &guid, &index);
    assert_eq!(result, None);
}

// The compose_queue returns stored message hash after send_compose
#[test]
fn test_compose_queue_after_send() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3, 4, 5]);

    context.mock_auth(&from, "send_compose", (&from, &to, &guid, &index, &message));
    endpoint_client.send_compose(&from, &to, &guid, &index, &message);

    let expected_hash = keccak256(env, &message);
    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &index), Some(expected_hash));
}
