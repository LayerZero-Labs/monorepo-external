use soroban_sdk::{testutils::Address as _, Address};

use crate::tests::endpoint_setup::setup;
// The is_registered_library is false for arbitrary addresses
#[test]
fn test_is_registered_library_false_for_unregistered_address() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let unregistered = Address::generate(env);
    assert!(!endpoint_client.is_registered_library(&unregistered));
}

// The is_registered_library becomes true after successful registration
#[test]
fn test_is_registered_library_true_after_register() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = context.setup_mock_message_lib(crate::MessageLibType::Send, soroban_sdk::vec![env, context.eid]);

    // Before registering.
    assert!(!endpoint_client.is_registered_library(&lib));

    // Register as owner.
    context.register_library_with_auth(&lib);

    // After registering.
    assert!(endpoint_client.is_registered_library(&lib));
}
