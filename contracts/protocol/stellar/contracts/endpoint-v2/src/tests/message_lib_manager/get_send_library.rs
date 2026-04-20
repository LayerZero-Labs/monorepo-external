use soroban_sdk::{testutils::Address as _, vec, Address};

use crate::{errors::EndpointError, tests::endpoint_setup::setup, MessageLibType, ResolvedLibrary};

// The get_send_library resolves default vs custom and is isolated per sender
#[test]
fn test_get_send_library_default_custom_and_isolated_per_sender() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let dst_eid = context.eid;
    let sender_a = Address::generate(env);
    let sender_b = Address::generate(env);

    let (default_send_lib, _fee_recipient) = context.setup_default_send_lib(dst_eid, 100, 0);

    // No custom set => both senders resolve to default.
    assert_eq!(
        endpoint_client.get_send_library(&sender_a, &dst_eid),
        ResolvedLibrary { lib: default_send_lib.clone(), is_default: true }
    );
    assert_eq!(
        endpoint_client.get_send_library(&sender_b, &dst_eid),
        ResolvedLibrary { lib: default_send_lib.clone(), is_default: true }
    );

    // Create and register a custom send lib for the same eid.
    let custom_send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, dst_eid]);
    context.register_library_with_auth(&custom_send_lib);

    // Sender A sets a custom send library.
    context.mock_auth(&sender_a, "set_send_library", (&sender_a, &sender_a, &dst_eid, &Some(custom_send_lib.clone())));
    endpoint_client.set_send_library(&sender_a, &sender_a, &dst_eid, &Some(custom_send_lib.clone()));

    // Sender A resolves to custom.
    let resolved_a = endpoint_client.get_send_library(&sender_a, &dst_eid);
    assert_eq!(resolved_a, ResolvedLibrary { lib: custom_send_lib, is_default: false });

    // Sender B resolves to default.
    let resolved_b = endpoint_client.get_send_library(&sender_b, &dst_eid);
    assert_eq!(resolved_b, ResolvedLibrary { lib: default_send_lib, is_default: true });
}

// The get_send_library returns custom even when no default exists
#[test]
fn test_get_send_library_custom_without_default() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let dst_eid_custom_only = context.eid;
    let sender = Address::generate(env);

    // Custom without default: register + set custom, then resolve to custom.
    let custom_send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, dst_eid_custom_only]);
    context.register_library_with_auth(&custom_send_lib);
    context.mock_auth(
        &sender,
        "set_send_library",
        (&sender, &sender, &dst_eid_custom_only, &Some(custom_send_lib.clone())),
    );
    endpoint_client.set_send_library(&sender, &sender, &dst_eid_custom_only, &Some(custom_send_lib.clone()));
    assert_eq!(
        endpoint_client.get_send_library(&sender, &dst_eid_custom_only),
        ResolvedLibrary { lib: custom_send_lib, is_default: false }
    );
}

// The get_send_library fails when neither default nor custom exists
#[test]
fn test_get_send_library_fails_without_default_and_custom() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let dst_eid = context.eid;
    let sender = Address::generate(env);

    // Missing both default and custom => DefaultSendLibUnavailable.
    let result = endpoint_client.try_get_send_library(&sender, &dst_eid);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::DefaultSendLibUnavailable.into());
}
