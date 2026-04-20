use soroban_sdk::vec;

use crate::tests::{endpoint_setup::setup, mock::MockValidMessageLib};

// Pagination and bounds behavior
#[test]
fn test_get_registered_libraries_pagination_and_bounds() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Empty set.
    assert_eq!(endpoint_client.registered_libraries_count(), 0);
    assert_eq!(endpoint_client.get_registered_libraries(&0, &1).len(), 0);
    assert_eq!(endpoint_client.get_registered_libraries(&999, &1).len(), 0);

    let lib0 = env.register(MockValidMessageLib, ());
    let lib1 = env.register(MockValidMessageLib, ());
    let lib2 = env.register(MockValidMessageLib, ());

    context.register_library_with_auth(&lib0);
    context.register_library_with_auth(&lib1);
    context.register_library_with_auth(&lib2);

    // max_count == 0 => empty.
    assert_eq!(endpoint_client.get_registered_libraries(&0, &0).len(), 0);
    assert_eq!(endpoint_client.get_registered_libraries(&1, &0).len(), 0);

    // start within bounds, normal pages.
    assert_eq!(endpoint_client.get_registered_libraries(&0, &2), vec![&env, lib0.clone(), lib1.clone()]);
    assert_eq!(endpoint_client.get_registered_libraries(&1, &2), vec![&env, lib1.clone(), lib2.clone()]);
    assert_eq!(endpoint_client.get_registered_libraries(&2, &2), vec![&env, lib2.clone()]);

    // start >= count => empty.
    assert_eq!(endpoint_client.get_registered_libraries(&3, &1).len(), 0);
    assert_eq!(endpoint_client.get_registered_libraries(&4, &10).len(), 0);
}

// Ordering follows registration index
#[test]
fn test_get_registered_libraries_orders_by_registration_index() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib0 = env.register(MockValidMessageLib, ());
    let lib1 = env.register(MockValidMessageLib, ());

    context.register_library_with_auth(&lib0);
    context.register_library_with_auth(&lib1);

    let libs = endpoint_client.get_registered_libraries(&0, &10);
    assert_eq!(libs, vec![&env, lib0.clone(), lib1.clone()]);
}

// The max_count larger than total count returns all remaining libraries
#[test]
fn test_get_registered_libraries_max_count_exceeds_total_returns_all() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib0 = env.register(MockValidMessageLib, ());
    let lib1 = env.register(MockValidMessageLib, ());
    let lib2 = env.register(MockValidMessageLib, ());

    context.register_library_with_auth(&lib0);
    context.register_library_with_auth(&lib1);
    context.register_library_with_auth(&lib2);

    // max_count is larger than total count; should return all.
    let libs = endpoint_client.get_registered_libraries(&0, &100);
    assert_eq!(libs, vec![&env, lib0.clone(), lib1.clone(), lib2.clone()]);
}
