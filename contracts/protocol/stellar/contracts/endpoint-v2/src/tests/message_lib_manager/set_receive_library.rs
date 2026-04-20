use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address,
};
use utils::testing_utils::{assert_contains_event, assert_contains_events};

use crate::{
    errors::EndpointError,
    events::{ReceiveLibrarySet, ReceiveLibraryTimeoutSet},
    tests::endpoint_setup::setup,
    tests::endpoint_setup::TestSetup,
    MessageLibType, ResolvedLibrary, Timeout,
};

// Helpers
fn try_set_receive_library_with_auth(
    context: &TestSetup,
    caller: &Address,
    receiver: &Address,
    src_eid: u32,
    new_lib: &Option<Address>,
    grace_period: u64,
) -> Result<Result<(), soroban_sdk::ConversionError>, Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_auth(caller, "set_receive_library", (caller, receiver, src_eid, new_lib, grace_period));
    context.endpoint_client.try_set_receive_library(caller, receiver, &src_eid, new_lib, &grace_period)
}

// Authorization (OApp auth required)
#[test]
fn test_set_receive_library_requires_oapp_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unauthorized_caller = Address::generate(env);

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // Mock auth for unauthorized caller (not the oapp or its delegate).
    context.mock_auth(
        &unauthorized_caller,
        "set_receive_library",
        (&unauthorized_caller, &oapp, &context.eid, &Some(receive_lib.clone()), &0u64),
    );

    let result =
        endpoint_client.try_set_receive_library(&unauthorized_caller, &oapp, &context.eid, &Some(receive_lib), &0u64);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

#[test]
fn test_set_receive_library_allows_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);

    // Set delegate for the OApp.
    let delegate_opt = Some(delegate.clone());
    context.mock_auth(&oapp, "set_delegate", (&oapp, &delegate_opt));
    endpoint_client.set_delegate(&oapp, &delegate_opt);

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // Delegate should succeed.
    context.set_receive_library_with_auth(&delegate, &oapp, context.eid, &Some(receive_lib.clone()), 0);

    // Verify event emission.
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &ReceiveLibrarySet { receiver: oapp.clone(), src_eid: context.eid, new_lib: Some(receive_lib.clone()) },
            &ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: context.eid, timeout: None },
        ],
    );

    // Verify state update via public interface.
    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: receive_lib, is_default: false }
    );
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &context.eid), None);
}

// Unregistered library rejection
#[test]
fn test_set_receive_library_unregistered_lib() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    // Create but do not register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    let result = try_set_receive_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(receive_lib), 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// Wrong library type rejection (must be Receive)
#[test]
fn test_set_receive_library_wrong_lib_type() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    // Create and register a send-only lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);
    context.register_library_with_auth(&send_lib);

    let result = try_set_receive_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(send_lib), 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyReceiveLib.into());
}

// Unsupported EID rejection (library must support src_eid)
#[test]
fn test_set_receive_library_unsupported_eid() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);
    let unsupported_eid = context.eid + 1;

    // Create and register a receive lib that only supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    let result = try_set_receive_library_with_auth(&context, &oapp, &oapp, unsupported_eid, &Some(receive_lib), 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::UnsupportedEid.into());
}

// Successful update (state update + event emission)
#[test]
fn test_set_receive_library_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    // Set up a default receive library first.
    let default_receive_lib = context.setup_default_receive_lib(context.eid, 0);

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // Verify initial state via public interface (should use default).
    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: default_receive_lib.clone(), is_default: true }
    );

    // Should succeed.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(receive_lib.clone()), 0);

    // Verify event emission.
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &ReceiveLibrarySet { receiver: oapp.clone(), src_eid: context.eid, new_lib: Some(receive_lib.clone()) },
            &ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: context.eid, timeout: None },
        ],
    );

    // Verify state update via public interface.
    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: receive_lib.clone(), is_default: false }
    );
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &context.eid), None);
}

// Successful update with SendAndReceive library type (valid for receive)
#[test]
fn test_set_receive_library_success_with_send_and_receive_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    // Create and register a SendAndReceive lib that supports `context.eid`.
    let send_and_receive_lib = context.setup_mock_message_lib(MessageLibType::SendAndReceive, vec![env, context.eid]);
    context.register_library_with_auth(&send_and_receive_lib);

    // Should succeed.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(send_and_receive_lib.clone()), 0);

    // Verify event emission.
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &ReceiveLibrarySet {
                receiver: oapp.clone(),
                src_eid: context.eid,
                new_lib: Some(send_and_receive_lib.clone()),
            },
            &ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: context.eid, timeout: None },
        ],
    );

    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: send_and_receive_lib.clone(), is_default: false }
    );
}

// Successful update with grace period (timeout should be set)
#[test]
fn test_set_receive_library_success_with_grace_period() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1000u64;

    // Set an arbitrary unix timestamp (seconds).
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    // Create and register valid receive libs that support `context.eid`.
    let old_receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    let new_receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&old_receive_lib);
    context.register_library_with_auth(&new_receive_lib);

    // First set the old library without grace period.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(old_receive_lib.clone()), 0);

    // Then set the new library with grace period.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(new_receive_lib.clone()), grace_period);

    let expected_timeout = Some(Timeout { lib: old_receive_lib.clone(), expiry: current_timestamp + grace_period });

    // Verify event emission (from the second call).
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &ReceiveLibrarySet { receiver: oapp.clone(), src_eid: context.eid, new_lib: Some(new_receive_lib.clone()) },
            &ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: context.eid, timeout: expected_timeout.clone() },
        ],
    );

    // Verify state update via public interface.
    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: new_receive_lib.clone(), is_default: false }
    );
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &context.eid), expected_timeout);
}

// Grace period > 0 requires both old and new libraries to be custom (non-default)
#[test]
fn test_set_receive_library_grace_period_requires_both_libs() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);
    let grace_period = 1000u64;

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    let result =
        try_set_receive_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(receive_lib), grace_period);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyNonDefaultLib.into());
}

#[test]
fn test_set_receive_library_grace_period_requires_both_libs_even_with_default_receive_lib() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);
    let grace_period = 1000u64;

    // Set up a default receive library. Even with a default, grace period logic still requires
    // both old and new libraries to be custom (non-default).
    context.setup_default_receive_lib(context.eid, 0);

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    let result =
        try_set_receive_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(receive_lib), grace_period);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyNonDefaultLib.into());
}

#[test]
fn test_set_receive_library_cannot_clear_to_none_with_grace_period() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);
    let grace_period = 1000u64;

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // First set a custom library.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(receive_lib), 0);

    // Clearing to default must use grace_period = 0. Any grace period should be rejected.
    let result = try_set_receive_library_with_auth(&context, &oapp, &oapp, context.eid, &None, grace_period);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyNonDefaultLib.into());
}

// The grace_period = 0 clears an existing timeout
#[test]
fn test_set_receive_library_grace_period_zero_clears_timeout() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    let t0 = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = t0);

    let lib_a = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    let lib_b = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    let lib_c = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);

    context.register_library_with_auth(&lib_a);
    context.register_library_with_auth(&lib_b);
    context.register_library_with_auth(&lib_c);

    // A: initial set (no timeout).
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(lib_a.clone()), 0);
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &ReceiveLibrarySet { receiver: oapp.clone(), src_eid, new_lib: Some(lib_a.clone()) },
            &ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: None },
        ],
    );

    // B: rotate with grace -> timeout for A must be set.
    let grace_period = 1_000u64;
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(lib_b.clone()), grace_period);
    let expected_timeout_b = Some(Timeout { lib: lib_a.clone(), expiry: t0 + grace_period });
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &ReceiveLibrarySet { receiver: oapp.clone(), src_eid, new_lib: Some(lib_b.clone()) },
            &ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: expected_timeout_b.clone() },
        ],
    );
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), expected_timeout_b.clone());

    // C: rotate with grace=0 -> timeout must be cleared (None).
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(lib_c.clone()), 0);
    assert_contains_event(
        env,
        &endpoint_client.address,
        ReceiveLibrarySet { receiver: oapp.clone(), src_eid, new_lib: Some(lib_c.clone()) },
    );
    assert_contains_event(
        env,
        &endpoint_client.address,
        ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: None },
    );
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), None);
}

// Clearing to None (removes custom library)
#[test]
fn test_set_receive_library_clear_to_none() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    // Set up a default receive library first.
    let default_receive_lib = context.setup_default_receive_lib(context.eid, 0);

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // First set Some(receive_lib).
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(receive_lib.clone()), 0);

    // Then clear to None.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &None, 0);

    // Verify event emission.
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &ReceiveLibrarySet { receiver: oapp.clone(), src_eid: context.eid, new_lib: None },
            &ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: context.eid, timeout: None },
        ],
    );

    // Verify state update via public interface (should fall back to default).
    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: default_receive_lib, is_default: true }
    );
}

// Updating from one custom library to another (A -> B)
#[test]
fn test_set_receive_library_can_change_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);

    let receive_lib_a = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    let receive_lib_b = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&receive_lib_a);
    context.register_library_with_auth(&receive_lib_b);

    // Set A first.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(receive_lib_a.clone()), 0);
    assert_contains_event(
        env,
        &endpoint_client.address,
        ReceiveLibrarySet { receiver: oapp.clone(), src_eid: context.eid, new_lib: Some(receive_lib_a.clone()) },
    );
    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: receive_lib_a.clone(), is_default: false }
    );

    // Then change to B.
    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(receive_lib_b.clone()), 0);
    assert_contains_event(
        env,
        &endpoint_client.address,
        ReceiveLibrarySet { receiver: oapp.clone(), src_eid: context.eid, new_lib: Some(receive_lib_b.clone()) },
    );
    assert_eq!(
        endpoint_client.get_receive_library(&oapp, &context.eid),
        ResolvedLibrary { lib: receive_lib_b.clone(), is_default: false }
    );
}

// Same value rejection (no-op is not allowed)
#[test]
fn test_set_receive_library_same_value() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    context.set_receive_library_with_auth(&oapp, &oapp, context.eid, &Some(receive_lib.clone()), 0);

    let result = try_set_receive_library_with_auth(&context, &oapp, &oapp, context.eid, &Some(receive_lib), 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::SameValue.into());
}

// Setting None when already None (SameValue)
#[test]
fn test_set_receive_library_none_when_already_none() {
    let context = setup();
    let env = &context.env;

    let oapp = Address::generate(env);

    let result = try_set_receive_library_with_auth(&context, &oapp, &oapp, context.eid, &None, 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::SameValue.into());
}
