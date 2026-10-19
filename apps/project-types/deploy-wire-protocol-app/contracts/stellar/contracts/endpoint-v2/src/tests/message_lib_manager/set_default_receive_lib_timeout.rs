use soroban_sdk::{testutils::Address as _, testutils::Ledger, vec, Address};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError,
    events::DefaultReceiveLibTimeoutSet,
    tests::endpoint_setup::{setup, TestSetup},
    MessageLibType, Timeout,
};

// Helpers
fn set_default_receive_lib_timeout_with_auth(context: &TestSetup, src_eid: u32, timeout: &Option<Timeout>) {
    context.mock_owner_auth("set_default_receive_lib_timeout", (&src_eid, timeout));
    context.endpoint_client.set_default_receive_lib_timeout(&src_eid, timeout);
}

fn try_set_default_receive_lib_timeout_with_auth(
    context: &TestSetup,
    src_eid: u32,
    timeout: &Option<Timeout>,
) -> Result<(), Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_owner_auth("set_default_receive_lib_timeout", (&src_eid, timeout));
    context.endpoint_client.try_set_default_receive_lib_timeout(&src_eid, timeout).map(|r| r.expect("conversion error"))
}

// Authorization (only owner)
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_default_receive_lib_timeout_requires_owner_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let non_owner = Address::generate(env);

    // Create a valid timeout
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    let timeout = Some(Timeout { lib: receive_lib, expiry: env.ledger().timestamp() + 1000 });

    // Mock auth for non-owner
    context.mock_auth(&non_owner, "set_default_receive_lib_timeout", (&context.eid, &timeout));

    // Should fail when non-owner tries to set
    endpoint_client.set_default_receive_lib_timeout(&context.eid, &timeout);
}

// Unregistered library rejection
#[test]
fn test_set_default_receive_lib_timeout_unregistered_lib() {
    let context = setup();
    let env = &context.env;

    // Create but do not register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    let timeout = Some(Timeout { lib: receive_lib, expiry: env.ledger().timestamp() + 1000 });

    let result = try_set_default_receive_lib_timeout_with_auth(&context, context.eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// Wrong library type rejection (must be Receive)
#[test]
fn test_set_default_receive_lib_timeout_wrong_lib_type() {
    let context = setup();
    let env = &context.env;

    // Create and register a send-only lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&send_lib);

    let timeout = Some(Timeout { lib: send_lib, expiry: env.ledger().timestamp() + 1000 });

    let result = try_set_default_receive_lib_timeout_with_auth(&context, context.eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyReceiveLib.into());
}

// Unsupported EID rejection (library must support src_eid)
#[test]
fn test_set_default_receive_lib_timeout_unsupported_eid() {
    let context = setup();
    let env = &context.env;

    let unsupported_eid = context.eid + 1;

    // Create and register a receive lib that only supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    let timeout = Some(Timeout { lib: receive_lib, expiry: env.ledger().timestamp() + 1000 });

    let result = try_set_default_receive_lib_timeout_with_auth(&context, unsupported_eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::UnsupportedEid.into());
}

// Invalid expiry rejection (must be strictly greater than current timestamp)
#[test]
fn test_set_default_receive_lib_timeout_invalid_expiry() {
    let context = setup();
    let env = &context.env;

    let current_timestamp = 1_700_000_000;
    // Set the ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // Create timeout with expiry in the past
    let timeout = Some(Timeout {
        lib: receive_lib,
        expiry: current_timestamp - 100, // Past expiry
    });

    let result = try_set_default_receive_lib_timeout_with_auth(&context, context.eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidExpiry.into());
}

#[test]
fn test_set_default_receive_lib_timeout_invalid_expiry_equal_timestamp() {
    let context = setup();
    let env = &context.env;

    let current_timestamp = 1_700_000_000;
    // Set the ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // Create timeout with expiry equal to current timestamp
    let timeout = Some(Timeout {
        lib: receive_lib,
        expiry: current_timestamp, // Equal to current
    });

    let result = try_set_default_receive_lib_timeout_with_auth(&context, context.eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidExpiry.into());
}

// Successful update (state update + event emission)
#[test]
fn test_set_default_receive_lib_timeout_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000;
    let grace_period = 1000;

    // Set the ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    let timeout = Some(Timeout { lib: receive_lib.clone(), expiry: current_timestamp + grace_period });

    // Verify initial state via public interface.
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), None);

    // Should succeed.
    set_default_receive_lib_timeout_with_auth(&context, context.eid, &timeout);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: timeout.clone() },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), timeout.clone());
}

// Successful update with SendAndReceive library type (valid for receive)
#[test]
fn test_set_default_receive_lib_timeout_success_with_send_and_receive_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    // Create and register a SendAndReceive lib that supports `context.eid`.
    let send_and_receive_lib = context.setup_mock_message_lib(MessageLibType::SendAndReceive, vec![env, context.eid]);
    context.register_library_with_auth(&send_and_receive_lib);

    let timeout = Some(Timeout { lib: send_and_receive_lib.clone(), expiry: current_timestamp + 1000 });

    // Should succeed.
    set_default_receive_lib_timeout_with_auth(&context, context.eid, &timeout);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: timeout.clone() },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), timeout);
}

// Clearing timeout (None removes the timeout)
#[test]
fn test_set_default_receive_lib_timeout_success_with_none() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Should succeed with None (clears the timeout).
    set_default_receive_lib_timeout_with_auth(&context, context.eid, &None);

    // Verify event emission.
    assert_eq_event(env, &endpoint_client.address, DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: None });

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), None);
}

// Clearing an existing timeout (Some -> None)
#[test]
fn test_set_default_receive_lib_timeout_clears_existing_timeout() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    let timeout = Some(Timeout { lib: receive_lib.clone(), expiry: current_timestamp + 1000 });

    // First set a timeout.
    set_default_receive_lib_timeout_with_auth(&context, context.eid, &timeout);
    assert_eq_event(
        env,
        &endpoint_client.address,
        DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: timeout.clone() },
    );
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), timeout);

    // Then clear it.
    set_default_receive_lib_timeout_with_auth(&context, context.eid, &None);
    assert_eq_event(env, &endpoint_client.address, DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: None });
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), None);
}
