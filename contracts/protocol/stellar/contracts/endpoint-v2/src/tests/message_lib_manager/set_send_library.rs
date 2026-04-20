use soroban_sdk::{testutils::Address as _, vec, Address};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError, events::SendLibrarySet, storage, tests::endpoint_setup::setup,
    tests::endpoint_setup::TestSetup, MessageLibType, ResolvedLibrary,
};

// Helpers
fn try_set_send_library_with_auth(
    context: &TestSetup,
    caller: &Address,
    sender: &Address,
    dst_eid: u32,
    new_lib: &Option<Address>,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_auth(caller, "set_send_library", (caller, sender, dst_eid, new_lib));
    context.endpoint_client.try_set_send_library(caller, sender, &dst_eid, new_lib)
}

// Authorization (OApp auth required)
#[test]
fn test_set_send_library_requires_oapp_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unauthorized_caller = Address::generate(env);

    // Create and register a valid send lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&send_lib);

    // Mock auth for unauthorized caller (not the oapp or its delegate).
    context.mock_auth(
        &unauthorized_caller,
        "set_send_library",
        (&unauthorized_caller, &oapp, &context.eid, &Some(send_lib.clone())),
    );

    let result = endpoint_client.try_set_send_library(&unauthorized_caller, &oapp, &context.eid, &Some(send_lib));
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

#[test]
fn test_set_send_library_allows_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);

    // Set delegate for the OApp.
    let delegate_opt = Some(delegate.clone());
    context.mock_auth(&oapp, "set_delegate", (&oapp, &delegate_opt));
    endpoint_client.set_delegate(&oapp, &delegate_opt);

    // Create and register a valid send lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&send_lib);

    // Delegate should succeed.
    context.set_send_library_with_auth(&delegate, &oapp, context.eid, &Some(send_lib.clone()));

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        SendLibrarySet { sender: oapp.clone(), dst_eid: context.eid, new_lib: Some(send_lib.clone()) },
    );

    // Verify state update via public interface.
    assert_eq!(
        endpoint_client.get_send_library(&oapp, &context.eid),
        ResolvedLibrary { lib: send_lib, is_default: false }
    );
}

// Unregistered library rejection
#[test]
fn test_set_send_library_unregistered_lib() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    // Create but do not register a valid send lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    let result = try_set_send_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(send_lib));
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// Wrong library type rejection (must be Send)
#[test]
fn test_set_send_library_wrong_lib_type() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    // Create and register a receive-only lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    let result = try_set_send_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(receive_lib));
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlySendLib.into());
}

// Unsupported EID rejection (library must support dst_eid)
#[test]
fn test_set_send_library_unsupported_eid() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);
    let unsupported_eid = context.eid + 1;

    // Create and register a send lib that only supports `context.eid`.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&send_lib);

    let result = try_set_send_library_with_auth(&context, &oapp, &oapp, unsupported_eid, &Some(send_lib));
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::UnsupportedEid.into());
}

// Successful update (state update + event emission)
#[test]
fn test_set_send_library_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    // Create and register a valid send lib that supports `context.eid`.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&send_lib);

    // Verify initial state via storage (no public getter for custom send_library).
    let initial_lib =
        env.as_contract(&endpoint_client.address, || storage::EndpointStorage::send_library(env, &oapp, context.eid));
    assert_eq!(initial_lib, None);

    // Should succeed.
    context.set_send_library_with_auth(&oapp, &oapp, context.eid, &Some(send_lib.clone()));

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        SendLibrarySet { sender: oapp.clone(), dst_eid: context.eid, new_lib: Some(send_lib.clone()) },
    );

    assert_eq!(
        endpoint_client.get_send_library(&oapp, &context.eid),
        ResolvedLibrary { lib: send_lib.clone(), is_default: false }
    );
}

// Successful update with SendAndReceive library type (valid for send)
#[test]
fn test_set_send_library_success_with_send_and_receive_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    // Create and register a SendAndReceive lib that supports `context.eid`.
    let send_and_receive_lib = context.setup_mock_message_lib(MessageLibType::SendAndReceive, vec![env, context.eid]);
    context.register_library_with_auth(&send_and_receive_lib);

    // Should succeed.
    context.set_send_library_with_auth(&oapp, &oapp, context.eid, &Some(send_and_receive_lib.clone()));

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        SendLibrarySet { sender: oapp.clone(), dst_eid: context.eid, new_lib: Some(send_and_receive_lib.clone()) },
    );

    assert_eq!(
        endpoint_client.get_send_library(&oapp, &context.eid),
        ResolvedLibrary { lib: send_and_receive_lib.clone(), is_default: false }
    );
}

// Updating from one custom library to another (A -> B)
#[test]
fn test_set_send_library_can_change_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    let send_lib_a = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    let send_lib_b = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    context.register_library_with_auth(&send_lib_a);
    context.register_library_with_auth(&send_lib_b);

    // Set A first.
    context.set_send_library_with_auth(&oapp, &oapp, context.eid, &Some(send_lib_a.clone()));
    assert_eq_event(
        env,
        &endpoint_client.address,
        SendLibrarySet { sender: oapp.clone(), dst_eid: context.eid, new_lib: Some(send_lib_a.clone()) },
    );
    assert_eq!(
        endpoint_client.get_send_library(&oapp, &context.eid),
        ResolvedLibrary { lib: send_lib_a.clone(), is_default: false }
    );

    // Then change to B.
    context.set_send_library_with_auth(&oapp, &oapp, context.eid, &Some(send_lib_b.clone()));
    assert_eq_event(
        env,
        &endpoint_client.address,
        SendLibrarySet { sender: oapp.clone(), dst_eid: context.eid, new_lib: Some(send_lib_b.clone()) },
    );
    assert_eq!(
        endpoint_client.get_send_library(&oapp, &context.eid),
        ResolvedLibrary { lib: send_lib_b.clone(), is_default: false }
    );
}

// Same value rejection (no-op is not allowed)
#[test]
fn test_set_send_library_same_value() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    // Create and register a valid send lib that supports `context.eid`.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&send_lib);

    context.set_send_library_with_auth(&oapp, &oapp, context.eid, &Some(send_lib.clone()));

    let result = try_set_send_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(send_lib));
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::SameValue.into());
}

#[test]
fn test_set_send_library_none_when_already_none() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    let result = try_set_send_library_with_auth(&context, &oapp, &oapp, context.eid, &None);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::SameValue.into());
}

// Clearing to None falls back to the default send library
#[test]
fn test_set_send_library_clear_to_none_falls_back_to_default() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    // Set up a default send library first so `get_send_library` can resolve the default.
    let (default_send_lib, _fee_recipient) = context.setup_default_send_lib(context.eid, 1i128, 0i128);
    assert_eq!(endpoint_client.default_send_library(&context.eid), Some(default_send_lib.clone()));

    // Create and register a valid send lib that supports `context.eid`.
    let custom_send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&custom_send_lib);

    // Set a custom library.
    context.set_send_library_with_auth(&oapp, &oapp, context.eid, &Some(custom_send_lib.clone()));
    assert_eq_event(
        env,
        &endpoint_client.address,
        SendLibrarySet { sender: oapp.clone(), dst_eid: context.eid, new_lib: Some(custom_send_lib.clone()) },
    );
    assert_eq!(
        endpoint_client.get_send_library(&oapp, &context.eid),
        ResolvedLibrary { lib: custom_send_lib.clone(), is_default: false }
    );

    // Then clear to None (should fall back to default).
    context.set_send_library_with_auth(&oapp, &oapp, context.eid, &None);
    assert_eq_event(
        env,
        &endpoint_client.address,
        SendLibrarySet { sender: oapp.clone(), dst_eid: context.eid, new_lib: None },
    );
    assert_eq!(
        env.as_contract(&endpoint_client.address, || storage::EndpointStorage::send_library(env, &oapp, context.eid)),
        None
    );
    assert_eq!(
        endpoint_client.get_send_library(&oapp, &context.eid),
        ResolvedLibrary { lib: default_send_lib, is_default: true }
    );
}
