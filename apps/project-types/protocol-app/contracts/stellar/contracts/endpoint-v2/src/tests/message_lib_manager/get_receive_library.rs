use soroban_sdk::{testutils::Address as _, vec, Address};

use crate::{errors::EndpointError, tests::endpoint_setup::setup, MessageLibType, ResolvedLibrary};

// The get_receive_library resolves default vs custom and is isolated per receiver
#[test]
fn test_get_receive_library_default_custom_and_isolated_per_receiver() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = context.eid;
    let receiver_a = Address::generate(env);
    let receiver_b = Address::generate(env);

    let default_receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // No custom set => both receivers resolve to default.
    assert_eq!(
        endpoint_client.get_receive_library(&receiver_a, &src_eid),
        ResolvedLibrary { lib: default_receive_lib.clone(), is_default: true }
    );
    assert_eq!(
        endpoint_client.get_receive_library(&receiver_b, &src_eid),
        ResolvedLibrary { lib: default_receive_lib, is_default: true }
    );

    // Create and register a custom receive lib for the same eid.
    let custom_receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&custom_receive_lib);

    // Receiver A sets a custom receive library for itself.
    context.mock_auth(
        &receiver_a,
        "set_receive_library",
        (&receiver_a, &receiver_a, &src_eid, &Some(custom_receive_lib.clone()), &0u64),
    );
    endpoint_client.set_receive_library(&receiver_a, &receiver_a, &src_eid, &Some(custom_receive_lib.clone()), &0u64);

    // Receiver A resolves to custom.
    assert_eq!(
        endpoint_client.get_receive_library(&receiver_a, &src_eid),
        ResolvedLibrary { lib: custom_receive_lib, is_default: false }
    );

    // Receiver B resolves to default.
    assert_eq!(
        endpoint_client.get_receive_library(&receiver_b, &src_eid),
        ResolvedLibrary { lib: endpoint_client.get_receive_library(&receiver_b, &src_eid).lib, is_default: true }
    );
}

// The get_receive_library returns custom even when no default exists
#[test]
fn test_get_receive_library_custom_without_default() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    let custom_receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&custom_receive_lib);

    context.mock_auth(
        &receiver,
        "set_receive_library",
        (&receiver, &receiver, &src_eid, &Some(custom_receive_lib.clone()), &0u64),
    );
    endpoint_client.set_receive_library(&receiver, &receiver, &src_eid, &Some(custom_receive_lib.clone()), &0u64);

    assert_eq!(
        endpoint_client.get_receive_library(&receiver, &src_eid),
        ResolvedLibrary { lib: custom_receive_lib, is_default: false }
    );
}

// The get_receive_library fails when neither default nor custom exists
#[test]
fn test_get_receive_library_fails_without_default_and_custom() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Missing both default and custom => DefaultReceiveLibUnavailable.
    let result = endpoint_client.try_get_receive_library(&receiver, &src_eid);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::DefaultReceiveLibUnavailable.into());
}
