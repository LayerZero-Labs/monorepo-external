use soroban_sdk::vec;

use crate::{tests::endpoint_setup::setup, EndpointV2, MessageLibType};

// The require_receive_lib_for_eid internal validation (registered + type + supported_eid)
#[test]
#[should_panic(expected = "Error(Contract, #16)")] // EndpointError::OnlyRegisteredLib
fn test_require_receive_lib_for_eid_unregistered_lib() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    env.as_contract(&endpoint_client.address, || EndpointV2::require_receive_lib_for_eid_for_test(env, &lib, context.eid));
}

#[test]
#[should_panic(expected = "Error(Contract, #15)")] // EndpointError::OnlyReceiveLib
fn test_require_receive_lib_for_eid_wrong_lib_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&lib);

    env.as_contract(&endpoint_client.address, || EndpointV2::require_receive_lib_for_eid_for_test(env, &lib, context.eid));
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")] // EndpointError::UnsupportedEid
fn test_require_receive_lib_for_eid_unsupported_eid() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let unsupported_eid = context.eid + 1;
    let lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&lib);

    env.as_contract(&endpoint_client.address, || EndpointV2::require_receive_lib_for_eid_for_test(env, &lib, unsupported_eid));
}

#[test]
fn test_require_receive_lib_for_eid_success_for_receive_and_send_and_receive() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::require_receive_lib_for_eid_for_test(env, &receive_lib, context.eid)
    });

    let send_and_receive = context.setup_mock_message_lib(MessageLibType::SendAndReceive, vec![env, context.eid]);
    context.register_library_with_auth(&send_and_receive);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::require_receive_lib_for_eid_for_test(env, &send_and_receive, context.eid)
    });
}
