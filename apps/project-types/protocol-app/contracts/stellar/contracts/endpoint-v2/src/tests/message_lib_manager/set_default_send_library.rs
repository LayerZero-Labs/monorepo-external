use soroban_sdk::{testutils::Address as _, vec, Address};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError, events::DefaultSendLibrarySet, tests::endpoint_setup::setup,
    tests::endpoint_setup::TestSetup, MessageLibType,
};

fn try_set_default_send_library_with_auth(
    context: &TestSetup,
    dst_eid: u32,
    send_lib: &Address,
) -> Result<(), Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_owner_auth("set_default_send_library", (&dst_eid, send_lib));
    context.endpoint_client.try_set_default_send_library(&dst_eid, send_lib).map(|r| r.expect("conversion error"))
}

// Unsupported EID rejection (library must support dst_eid)
#[test]
fn test_set_default_send_library_unsupported_eid() {
    let context = setup();
    let env = &context.env;

    let unsupported_eid = context.eid + 1;

    // Create and register a send lib that only supports `context.eid`.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    context.register_library_with_auth(&send_lib);

    let result = try_set_default_send_library_with_auth(&context, unsupported_eid, &send_lib);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::UnsupportedEid.into());
}

// Wrong library type rejection (must be Send)
#[test]
fn test_set_default_send_library_wrong_lib_type() {
    let context = setup();
    let env = &context.env;

    // Create and register a receive-only lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&receive_lib);

    let result = try_set_default_send_library_with_auth(&context, context.eid, &receive_lib);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlySendLib.into());
}

// Unregistered library rejection
#[test]
fn test_set_default_send_library_unregistered_lib() {
    let context = setup();
    let env = &context.env;

    // Create but do not register a valid send lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    let result = try_set_default_send_library_with_auth(&context, context.eid, &send_lib);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// Successful update (state update + event emission)
#[test]
fn test_set_default_send_library_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Create and register a valid send lib that supports `context.eid`.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    context.register_library_with_auth(&send_lib);

    // Verify initial state via public interface.
    assert_eq!(endpoint_client.default_send_library(&context.eid), None);

    // Should succeed.
    context.set_default_send_library_with_auth(context.eid, &send_lib);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        DefaultSendLibrarySet { dst_eid: context.eid, new_lib: send_lib.clone() },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_send_library(&context.eid), Some(send_lib.clone()));
}

// Successful update with SendAndReceive library type (valid for send)
#[test]
fn test_set_default_send_library_success_with_send_and_receive_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Create and register a SendAndReceive lib that supports `context.eid`.
    let send_and_receive_lib = context.setup_mock_message_lib(MessageLibType::SendAndReceive, vec![env, context.eid]);

    context.register_library_with_auth(&send_and_receive_lib);

    // Should succeed.
    context.set_default_send_library_with_auth(context.eid, &send_and_receive_lib);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        DefaultSendLibrarySet { dst_eid: context.eid, new_lib: send_and_receive_lib.clone() },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_send_library(&context.eid), Some(send_and_receive_lib));
}

// Updating from one default to another (A -> B)
#[test]
fn test_set_default_send_library_can_change_default_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let send_lib_a = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    let send_lib_b = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    context.register_library_with_auth(&send_lib_a);
    context.register_library_with_auth(&send_lib_b);

    // Set A as the default first.
    context.set_default_send_library_with_auth(context.eid, &send_lib_a);
    assert_eq_event(
        env,
        &endpoint_client.address,
        DefaultSendLibrarySet { dst_eid: context.eid, new_lib: send_lib_a.clone() },
    );
    assert_eq!(endpoint_client.default_send_library(&context.eid), Some(send_lib_a.clone()));

    // Then change the default to B.
    context.set_default_send_library_with_auth(context.eid, &send_lib_b);
    assert_eq_event(
        env,
        &endpoint_client.address,
        DefaultSendLibrarySet { dst_eid: context.eid, new_lib: send_lib_b.clone() },
    );
    assert_eq!(endpoint_client.default_send_library(&context.eid), Some(send_lib_b.clone()));
}

// Authorization (only owner)
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_default_send_library_requires_owner_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let non_owner = Address::generate(env);

    // Create and register a valid send lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    context.register_library_with_auth(&send_lib);

    // Mock auth for the non-owner (not the owner).
    context.mock_auth(&non_owner, "set_default_send_library", (&context.eid, &send_lib));

    // Should fail when a non-owner tries to set.
    endpoint_client.set_default_send_library(&context.eid, &send_lib);
}

// Same value rejection (no-op is not allowed)
#[test]
fn test_set_default_send_library_same_value() {
    let context = setup();
    let env = &context.env;

    // Create and register a valid send lib that supports `context.eid`.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    context.register_library_with_auth(&send_lib);
    context.set_default_send_library_with_auth(context.eid, &send_lib);

    let result = try_set_default_send_library_with_auth(&context, context.eid, &send_lib);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::SameValue.into());
}
