use soroban_sdk::{testutils::Address as _, Address};

use crate::{
    tests::{endpoint_setup::setup, mock::MockValidMessageLib},
    EndpointV2,
};

// Unit tests for require functions

#[test]
#[should_panic(expected = "Error(Contract, #16)")] // EndpointError::OnlyRegisteredLib
fn test_require_registered_with_unregistered_lib() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let unregistered_lib = Address::generate(env);

    env.as_contract(&endpoint_client.address, || EndpointV2::require_registered_for_test(env, &unregistered_lib));
}

#[test]
fn test_require_registered_with_registered_lib() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Register a valid message lib
    let lib = env.register(MockValidMessageLib, ());
    context.register_library_with_auth(&lib);

    // Should not panic
    env.as_contract(&endpoint_client.address, || EndpointV2::require_registered_for_test(env, &lib));
}
