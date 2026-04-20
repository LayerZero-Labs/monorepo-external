use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError,
    events::ComposeDelivered,
    tests::{
        endpoint_setup::{setup, TestSetup},
        messaging_composer::{MAX_COMPOSE_INDEX, RECEIVED_MESSAGE_HASH_BYTES},
    },
    util::keccak256,
};

// Helpers
fn received_hash(env: &soroban_sdk::Env) -> BytesN<32> {
    BytesN::from_array(env, &RECEIVED_MESSAGE_HASH_BYTES)
}

fn clear_compose_with_auth(
    context: &TestSetup,
    composer: &Address,
    from: &Address,
    guid: &BytesN<32>,
    index: u32,
    message: &Bytes,
) {
    context.mock_auth(composer, "clear_compose", (composer, from, guid, &index, message));
    context.endpoint_client.clear_compose(composer, from, guid, &index, message);
}

fn try_clear_compose_with_auth(
    context: &TestSetup,
    composer: &Address,
    from: &Address,
    guid: &BytesN<32>,
    index: u32,
    message: &Bytes,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_auth(composer, "clear_compose", (composer, from, guid, &index, message));
    context.endpoint_client.try_clear_compose(composer, from, guid, &index, message)
}

// Authorization (composer must authorize)
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clear_compose_requires_composer_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let composer = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3]);

    // No mock_auth for `composer` -> should panic at `composer.require_auth()`.
    endpoint_client.clear_compose(&composer, &from, &guid, &index, &message);
}

// Index bounds (<= MAX_COMPOSE_INDEX)
#[test]
fn test_clear_compose_fails_when_index_exceeds_max() {
    let context = setup();
    let env = &context.env;

    let from = Address::generate(env);
    let composer = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let message = Bytes::from_array(env, &[1, 2, 3]);

    let invalid_index = MAX_COMPOSE_INDEX + 1;
    let result = try_clear_compose_with_auth(&context, &composer, &from, &guid, invalid_index, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidIndex.into());
}

// Successful clear_compose marks compose_queue as RECEIVED and emits ComposeDelivered
#[test]
fn test_clear_compose_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let composer = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3, 4, 5]);

    context.send_compose_with_auth(&from, &composer, &guid, index, &message);
    assert_eq!(endpoint_client.compose_queue(&from, &composer, &guid, &index), Some(keccak256(env, &message)));

    clear_compose_with_auth(&context, &composer, &from, &guid, index, &message);
    assert_eq_event(
        env,
        &endpoint_client.address,
        ComposeDelivered { from: from.clone(), to: composer.clone(), guid: guid.clone(), index },
    );
    assert_eq!(endpoint_client.compose_queue(&from, &composer, &guid, &index), Some(received_hash(env)));
}

#[test]
fn test_clear_compose_does_not_affect_other_indices() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let composer = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let message1 = Bytes::from_array(env, &[1, 2, 3]);
    let message2 = Bytes::from_array(env, &[4, 5, 6]);

    context.send_compose_with_auth(&from, &composer, &guid, 0, &message1);
    context.send_compose_with_auth(&from, &composer, &guid, 1, &message2);

    clear_compose_with_auth(&context, &composer, &from, &guid, 0, &message1);
    assert_eq!(endpoint_client.compose_queue(&from, &composer, &guid, &0), Some(received_hash(env)));
    assert_eq!(endpoint_client.compose_queue(&from, &composer, &guid, &1), Some(keccak256(env, &message2)));
}

// ComposeNotFound cases
#[test]
fn test_clear_compose_not_found_when_missing_queue() {
    let context = setup();
    let env = &context.env;

    let from = Address::generate(env);
    let composer = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3]);

    let result = try_clear_compose_with_auth(&context, &composer, &from, &guid, index, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ComposeNotFound.into());
}

#[test]
fn test_clear_compose_not_found_when_wrong_message() {
    let context = setup();
    let env = &context.env;

    let from = Address::generate(env);
    let composer = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3]);
    let wrong_message = Bytes::from_array(env, &[9, 9, 9]);

    context.send_compose_with_auth(&from, &composer, &guid, index, &message);

    let result = try_clear_compose_with_auth(&context, &composer, &from, &guid, index, &wrong_message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ComposeNotFound.into());
}

#[test]
fn test_clear_compose_not_found_when_already_cleared() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let composer = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3]);

    // After a successful clear, the queue is set to RECEIVED marker, so clearing again should fail.
    context.send_compose_with_auth(&from, &composer, &guid, index, &message);
    clear_compose_with_auth(&context, &composer, &from, &guid, index, &message);
    assert_eq!(endpoint_client.compose_queue(&from, &composer, &guid, &index), Some(received_hash(env)));

    let result = try_clear_compose_with_auth(&context, &composer, &from, &guid, index, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ComposeNotFound.into());
}

#[test]
fn test_clear_compose_not_found_when_wrong_composer_and_does_not_mutate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let composer_a = Address::generate(env);
    let composer_b = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3]);

    // Queue a compose message for composer_a.
    context.send_compose_with_auth(&from, &composer_a, &guid, index, &message);
    assert_eq!(endpoint_client.compose_queue(&from, &composer_a, &guid, &index), Some(keccak256(env, &message)));
    assert_eq!(endpoint_client.compose_queue(&from, &composer_b, &guid, &index), None);

    // composer_b cannot clear composer_a's queued compose.
    let result = try_clear_compose_with_auth(&context, &composer_b, &from, &guid, index, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ComposeNotFound.into());

    // Ensure the failed attempt did not mutate composer_a's queued entry.
    assert_eq!(endpoint_client.compose_queue(&from, &composer_a, &guid, &index), Some(keccak256(env, &message)));
    assert_eq!(endpoint_client.compose_queue(&from, &composer_b, &guid, &index), None);
}
