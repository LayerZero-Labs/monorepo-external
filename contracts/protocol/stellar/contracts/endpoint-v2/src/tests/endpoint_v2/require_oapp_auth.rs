use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

use crate::{tests::endpoint_setup::setup, EndpointV2};

// NOTE ABOUT COVERAGE
//
// `require_oapp_auth` has two "success" paths:
// - caller == oapp
// - caller == delegate(oapp)
//
// Those success paths MUST also satisfy `caller.require_auth()`.
// Calling `require_oapp_auth` directly from a unit test is brittle because the mocked auth context
// is keyed off the *public contract invocation* (e.g. `clear`), not internal function calls.
//
// We intentionally do NOT test the success paths here.
// They are covered end-to-end via the public `clear()` entrypoint in `clear.rs`:
// - OApp (receiver) clears successfully (covers caller == oapp)
// - Delegate clears successfully (covers caller == delegate(oapp))

// Unauthorized caller is rejected
#[test]
#[should_panic(expected = "Error(Contract, #22)")] // EndpointError::Unauthorized
fn test_require_oapp_auth_unauthorized() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let oapp = Address::generate(env);
    let unauthorized = Address::generate(env);

    // Unauthorized address (not oapp itself and not delegate) should fail with Unauthorized error
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::require_oapp_auth_for_test(env, &unauthorized, &oapp);
    });
}

// Wrong delegate is rejected
#[test]
#[should_panic(expected = "Error(Contract, #22)")] // EndpointError::Unauthorized
fn test_require_oapp_auth_wrong_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    let oapp = Address::generate(env);
    let delegate = Address::generate(env);
    let wrong_delegate = Address::generate(env);

    // Set delegate
    let delegate_option = Some(delegate);
    context.set_delegate_with_auth(&oapp, &delegate_option);

    // Wrong delegate (not the actual delegate) should fail with Unauthorized error
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::require_oapp_auth_for_test(env, &wrong_delegate, &oapp);
    });
}
