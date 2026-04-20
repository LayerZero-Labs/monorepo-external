use soroban_sdk::{testutils::Address as _, vec, Address};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError,
    events::LibraryRegistered,
    storage,
    tests::{
        endpoint_setup::setup,
        mock::{MockMessageLib, MockReceiver, MockValidMessageLib},
    },
};

// Successful registration (state update + event emission)
#[test]
fn test_register_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = env.register(MockValidMessageLib, ());

    // Verify initial state via public interface.
    assert_eq!(endpoint_client.registered_libraries_count(), 0);
    assert!(!endpoint_client.is_registered_library(&lib));

    context.register_library_with_auth(&lib);

    // Verify event emission.
    assert_eq_event(env, &endpoint_client.address, LibraryRegistered { new_lib: lib.clone() });

    // Verify state update via public interface.
    assert!(endpoint_client.is_registered_library(&lib));
    assert_eq!(endpoint_client.registered_libraries_count(), 1);

    let libraries = endpoint_client.get_registered_libraries(&0, &1);
    assert_eq!(libraries, vec![&env, lib.clone()]);

    // Verify storage invariants (bidirectional index mapping).
    let lib_clone = lib.clone();
    env.as_contract(&endpoint_client.address, || {
        let library_id = storage::EndpointStorage::library_to_index(env, &lib_clone);
        assert_eq!(library_id, Some(0));

        let stored_lib = storage::EndpointStorage::index_to_library(env, 0);
        assert_eq!(stored_lib, Some(lib_clone.clone()));

        let new_count = storage::EndpointStorage::registered_libraries_count(env);
        assert_eq!(new_count, 1);

        let has_library = storage::EndpointStorage::has_library_to_index(env, &lib_clone);
        assert!(has_library);
    });
}

// Duplicate registration rejection
#[test]
fn test_register_library_is_already_registered() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = env.register(MockValidMessageLib, ());

    context.register_library_with_auth(&lib);

    context.mock_owner_auth("register_library", (&lib,));
    let result = endpoint_client.try_register_library(&lib);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::AlreadyRegistered.into());
}

// Invalid library interface rejection (must implement message_lib_type)
#[test]
fn test_register_library_is_unsupported_interface() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // A contract that does NOT implement `message_lib_type()`.
    let invalid_lib = env.register(MockReceiver, ());

    // Must pass owner auth so this test actually exercises interface validation.
    context.mock_owner_auth("register_library", (&invalid_lib,));
    let result = endpoint_client.try_register_library(&invalid_lib);
    assert!(result.is_err());

    // Verify no partial state updates.
    assert_eq!(endpoint_client.registered_libraries_count(), 0);
    assert!(!endpoint_client.is_registered_library(&invalid_lib));

    // Verify no partial storage updates.
    env.as_contract(&endpoint_client.address, || {
        assert_eq!(storage::EndpointStorage::registered_libraries_count(env), 0);
        assert_eq!(storage::EndpointStorage::library_to_index(env, &invalid_lib), None);
        assert!(!storage::EndpointStorage::has_library_to_index(env, &invalid_lib));
    });
}

// Authorization (only owner)
#[test]
fn test_register_library_owner_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = env.register(MockMessageLib, ());

    context.register_library_with_auth(&lib);

    let library = endpoint_client.get_registered_libraries(&0, &1);
    assert_eq!(library, vec![&env, lib]);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_register_library_without_owner_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = Address::generate(env);
    let non_owner = Address::generate(env);

    // Mock auth for non-owner
    context.mock_auth(&non_owner, "register_library", (&lib,));

    endpoint_client.register_library(&lib);
}

// Sequential index assignment (storage invariants)
#[test]
fn test_register_multiple_libraries_assigns_sequential_indices_and_orders_results() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib0 = env.register(MockValidMessageLib, ());
    let lib1 = env.register(MockValidMessageLib, ());

    context.register_library_with_auth(&lib0);
    context.register_library_with_auth(&lib1);

    // storage invariants
    let lib0c = lib0.clone();
    let lib1c = lib1.clone();
    env.as_contract(&endpoint_client.address, || {
        assert_eq!(storage::EndpointStorage::registered_libraries_count(env), 2);
        assert_eq!(storage::EndpointStorage::library_to_index(env, &lib0c), Some(0));
        assert_eq!(storage::EndpointStorage::library_to_index(env, &lib1c), Some(1));
        assert_eq!(storage::EndpointStorage::index_to_library(env, 0), Some(lib0c));
        assert_eq!(storage::EndpointStorage::index_to_library(env, 1), Some(lib1c));
    });
}
