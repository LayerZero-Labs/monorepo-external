use crate::tests::{endpoint_setup::setup, mock::MockValidMessageLib};

// The registered_libraries_count increments after successful registrations
#[test]
fn test_registered_libraries_count_increments_with_registrations() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib0 = env.register(MockValidMessageLib, ());
    let lib1 = env.register(MockValidMessageLib, ());
    let lib2 = env.register(MockValidMessageLib, ());

    assert_eq!(endpoint_client.registered_libraries_count(), 0);

    context.register_library_with_auth(&lib0);
    assert_eq!(endpoint_client.registered_libraries_count(), 1);

    context.register_library_with_auth(&lib1);
    assert_eq!(endpoint_client.registered_libraries_count(), 2);

    context.register_library_with_auth(&lib2);
    assert_eq!(endpoint_client.registered_libraries_count(), 3);
}

// Failed registration does not change registered_libraries_count
#[test]
fn test_registered_libraries_count_unchanged_on_duplicate_registration() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = env.register(MockValidMessageLib, ());
    context.register_library_with_auth(&lib);
    assert_eq!(endpoint_client.registered_libraries_count(), 1);

    // Duplicate registration should fail and not change count.
    context.mock_owner_auth("register_library", (&lib,));
    let result = endpoint_client.try_register_library(&lib);
    assert!(result.is_err());
    assert_eq!(endpoint_client.registered_libraries_count(), 1);
}
