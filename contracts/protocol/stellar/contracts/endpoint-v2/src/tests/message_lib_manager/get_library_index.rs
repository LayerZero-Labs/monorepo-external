use soroban_sdk::{testutils::Address as _, Address};

use crate::tests::{endpoint_setup::setup, mock::MockValidMessageLib};

// The get_library_index is None for arbitrary (unregistered) addresses
#[test]
fn test_get_library_index_for_unregistered_library_is_none() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let unregistered = Address::generate(env);
    assert!(!endpoint_client.is_registered_library(&unregistered));
    assert_eq!(endpoint_client.get_library_index(&unregistered), None);
}

// The get_library_index returns Some(index) after successful registration
#[test]
fn test_get_library_index_for_registered_library_is_some() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = env.register(MockValidMessageLib, ());

    context.register_library_with_auth(&lib);

    assert!(endpoint_client.is_registered_library(&lib));
    assert_eq!(endpoint_client.get_library_index(&lib), Some(0));
    assert_eq!(endpoint_client.registered_libraries_count(), 1);
}

// Indices are sequential and stable across multiple registrations
#[test]
fn test_get_library_index_multiple_libraries_are_sequential() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib0 = env.register(MockValidMessageLib, ());
    let lib1 = env.register(MockValidMessageLib, ());
    let lib2 = env.register(MockValidMessageLib, ());

    context.register_library_with_auth(&lib0);
    context.register_library_with_auth(&lib1);
    context.register_library_with_auth(&lib2);

    assert_eq!(endpoint_client.get_library_index(&lib0), Some(0));
    assert_eq!(endpoint_client.get_library_index(&lib1), Some(1));
    assert_eq!(endpoint_client.get_library_index(&lib2), Some(2));
    assert_eq!(endpoint_client.registered_libraries_count(), 3);
}
