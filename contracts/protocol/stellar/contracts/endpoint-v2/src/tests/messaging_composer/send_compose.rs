use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError,
    events::ComposeSent,
    tests::{
        endpoint_setup::{setup, TestSetup},
        messaging_composer::MAX_COMPOSE_INDEX,
    },
    util::keccak256,
};

fn try_send_compose_with_auth(
    context: &TestSetup,
    from: &Address,
    to: &Address,
    guid: &BytesN<32>,
    index: u32,
    message: &Bytes,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_auth(from, "send_compose", (from, to, guid, &index, message));
    context.endpoint_client.try_send_compose(from, to, guid, &index, message)
}

// Authorization (from must authorize)
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_send_compose_requires_from_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::from_array(env, &[1, 2, 3]);

    // No mock_auth for `from` -> should panic at `from.require_auth()`.
    endpoint_client.send_compose(&from, &to, &guid, &index, &message);
}

// Index bounds (<= MAX_COMPOSE_INDEX)
#[test]
fn test_send_compose_fails_when_index_exceeds_max() {
    let context = setup();
    let env = &context.env;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let invalid_index = MAX_COMPOSE_INDEX + 1;
    let message = Bytes::from_array(env, &[1, 2, 3]);

    let result = try_send_compose_with_auth(&context, &from, &to, &guid, invalid_index, &message);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidIndex.into());
}

#[test]
fn test_send_compose_succeeds_at_max_index() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = MAX_COMPOSE_INDEX;
    let message = Bytes::from_array(env, &[1, 2, 3]);

    context.send_compose_with_auth(&from, &to, &guid, index, &message);
    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &index), Some(keccak256(env, &message)));
}

// Successful send_compose stores compose_queue and emits ComposeSent
#[test]
fn test_send_compose_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 1u32;
    let message = Bytes::from_array(env, &[1, 2, 3, 4, 5]);

    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &index), None);
    context.send_compose_with_auth(&from, &to, &guid, index, &message);

    // Verify the event was published.
    assert_eq_event(
        env,
        &endpoint_client.address,
        ComposeSent { from: from.clone(), to: to.clone(), guid: guid.clone(), index, message: message.clone() },
    );

    // Verify the compose queue was set via public interface.
    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &index), Some(keccak256(env, &message)));
}

// Empty message is allowed
#[test]
fn test_send_compose_allows_empty_message() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let index = 0u32;
    let message = Bytes::new(env);

    context.send_compose_with_auth(&from, &to, &guid, index, &message);
    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &index), Some(keccak256(env, &message)));
}

// The compose_queue keying (from/to/guid/index) and uniqueness
#[test]
fn test_send_compose_keying_and_compose_exists() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let from = Address::generate(env);
    let to = Address::generate(env);
    let guid = BytesN::from_array(env, &[1u8; 32]);
    let message1 = Bytes::from_array(env, &[1, 2, 3]);
    let message2 = Bytes::from_array(env, &[4, 5, 6]);

    // Baseline: store one compose entry.
    context.send_compose_with_auth(&from, &to, &guid, 0, &message1);
    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &0), Some(keccak256(env, &message1)));

    // Different index should be independent.
    context.send_compose_with_auth(&from, &to, &guid, 1, &message2);
    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &1), Some(keccak256(env, &message2)));

    // Same (from,to,guid,index) => ComposeExists.
    let result = try_send_compose_with_auth(&context, &from, &to, &guid, 0, &message2);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::ComposeExists.into());

    // Ensure ComposeExists did not overwrite the originally stored entry.
    assert_eq!(endpoint_client.compose_queue(&from, &to, &guid, &0), Some(keccak256(env, &message1)));
}
