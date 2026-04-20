use soroban_sdk::{testutils::Address as _, vec, Address};

use crate::{tests::endpoint_setup::setup, EndpointV2, MessageLibType};

// The require_supported_eid passes when the library supports the EID
#[test]
fn test_require_supported_eid_with_supported() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    env.as_contract(&endpoint_client.address, || EndpointV2::require_supported_eid_for_test(env, &send_lib, context.eid));
}

// The require_supported_eid rejects when the library does not support the EID
#[test]
#[should_panic(expected = "Error(Contract, #23)")] // EndpointError::UnsupportedEid
fn test_require_supported_eid_with_unsupported() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let unsupported_eid = context.eid + 1;
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    env.as_contract(&endpoint_client.address, || EndpointV2::require_supported_eid_for_test(env, &send_lib, unsupported_eid));
}

// The require_supported_eid panics if the library address has no deployed contract
#[test]
#[should_panic(expected = "trying to get non-existing value for contract instance")]
fn test_require_supported_eid_with_non_deployed_lib() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Address that doesn't have a contract deployed
    let non_existent_lib = Address::generate(env);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::require_supported_eid_for_test(env, &non_existent_lib, context.eid)
    });
}
