use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address,
};
use utils::testing_utils::{assert_contains_event, assert_contains_events};

use crate::{
    errors::EndpointError,
    events::{DefaultReceiveLibTimeoutSet, DefaultReceiveLibrarySet},
    tests::endpoint_setup::{setup, TestSetup},
    MessageLibType, Timeout,
};

fn try_set_default_receive_library_with_auth(
    context: &TestSetup,
    src_eid: u32,
    receive_lib: &Address,
    grace_period: u64,
) -> Result<(), Result<soroban_sdk::Error, soroban_sdk::InvokeError>> {
    context.mock_owner_auth("set_default_receive_library", (&src_eid, receive_lib, &grace_period));
    context
        .endpoint_client
        .try_set_default_receive_library(&src_eid, receive_lib, &grace_period)
        .map(|r| r.expect("conversion error"))
}

// Unsupported EID rejection (library must support src_eid)
#[test]
fn test_set_default_receive_library_unsupported_eid() {
    let context = setup();
    let env = &context.env;

    let unsupported_eid = context.eid + 1;

    // Create and register a receive lib that only supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&receive_lib);

    let result = try_set_default_receive_library_with_auth(&context, unsupported_eid, &receive_lib, 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::UnsupportedEid.into());
}

// Wrong library type rejection (must be Receive)
#[test]
fn test_set_default_receive_library_wrong_lib_type() {
    let context = setup();
    let env = &context.env;

    // Create and register a send-only lib that supports `context.eid`.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, context.eid]);

    context.register_library_with_auth(&send_lib);

    let result = try_set_default_receive_library_with_auth(&context, context.eid, &send_lib, 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyReceiveLib.into());
}

// Unregistered library rejection
#[test]
fn test_set_default_receive_library_unregistered_lib() {
    let context = setup();
    let env = &context.env;

    // Create but do not register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    // Try to set it as default without registering (should panic).
    //
    // Note: a non-deployed address is also "not registered" from the endpoint's perspective, so it
    // will fail with the same error as well.
    let result = try_set_default_receive_library_with_auth(&context, context.eid, &receive_lib, 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// Successful update (state update + event emission)
#[test]
fn test_set_default_receive_library_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&receive_lib);

    // Verify initial state via public interface.
    assert_eq!(endpoint_client.default_receive_library(&context.eid), None);

    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), None);

    // Should succeed.
    context.set_default_receive_library_with_auth(context.eid, &receive_lib, 0);

    // Verify event emission.
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid: context.eid, new_lib: receive_lib.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: None },
        ],
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_receive_library(&context.eid), Some(receive_lib.clone()));

    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), None);
}

// Successful update with grace period (timeout should be set)
#[test]
fn test_set_default_receive_library_success_with_grace_period() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000;
    let grace_period = 1000;
    // Set an arbitrary unix timestamp (seconds)
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    // Create and register valid receive libs that support `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    let new_receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&receive_lib);
    context.register_library_with_auth(&new_receive_lib);

    // First set the default receive library.
    context.set_default_receive_library_with_auth(context.eid, &receive_lib, 0);

    // Then set the default receive library with the grace period.
    context.set_default_receive_library_with_auth(context.eid, &new_receive_lib, grace_period);

    let expected_timeout = Some(Timeout { lib: receive_lib.clone(), expiry: current_timestamp + grace_period });

    // Verify event emission (from the second call).
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid: context.eid, new_lib: new_receive_lib.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: expected_timeout.clone() },
        ],
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_receive_library(&context.eid), Some(new_receive_lib.clone()));
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), expected_timeout.clone());
}

// Grace period > 0 with no previous default (timeout must remain None)
#[test]
fn test_set_default_receive_library_grace_period_with_no_previous_default_sets_no_timeout() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let grace_period = 1_000u64;

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib);

    // First-time set with grace period (no old default exists).
    context.set_default_receive_library_with_auth(context.eid, &receive_lib, grace_period);

    // Timeout must be None because there was no previous default to keep alive.
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid: context.eid, new_lib: receive_lib.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: None },
        ],
    );

    assert_eq!(endpoint_client.default_receive_library(&context.eid), Some(receive_lib));
    assert_eq!(endpoint_client.default_receive_library_timeout(&context.eid), None);
}

// Clearing an existing timeout by rotating with grace_period = 0
#[test]
fn test_set_default_receive_library_grace_period_zero_clears_timeout() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| {
        li.timestamp = current_timestamp;
    });

    let src_eid = context.eid;
    let grace_period = 1_000u64;

    let lib_a = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    let lib_b = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    let lib_c = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);

    context.register_library_with_auth(&lib_a);
    context.register_library_with_auth(&lib_b);
    context.register_library_with_auth(&lib_c);

    // A: initial set (no timeout).
    context.set_default_receive_library_with_auth(src_eid, &lib_a, 0);
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid, new_lib: lib_a.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid, timeout: None },
        ],
    );

    // B: rotate with grace -> timeout for A must be set.
    context.set_default_receive_library_with_auth(src_eid, &lib_b, grace_period);
    let expected_timeout_b = Some(Timeout { lib: lib_a.clone(), expiry: current_timestamp + grace_period });
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid, new_lib: lib_b.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid, timeout: expected_timeout_b.clone() },
        ],
    );

    // C: rotate with grace=0 -> timeout must be cleared (None).
    context.set_default_receive_library_with_auth(src_eid, &lib_c, 0);
    assert_contains_event(env, &endpoint_client.address, DefaultReceiveLibrarySet { src_eid, new_lib: lib_c.clone() });
    assert_contains_event(env, &endpoint_client.address, DefaultReceiveLibTimeoutSet { src_eid, timeout: None });

    assert_eq!(endpoint_client.default_receive_library(&src_eid), Some(lib_c));
    assert_eq!(endpoint_client.default_receive_library_timeout(&src_eid), None);
}

// Multi-rotation timeout references the immediate previous default (B -> C keeps B)
#[test]
fn test_set_default_receive_library_multi_rotation_timeout_uses_immediate_previous_default() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = context.eid;

    let t0 = 1_700_000_000u64;
    env.ledger().with_mut(|li| {
        li.timestamp = t0;
    });

    let lib_a = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    let lib_b = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    let lib_c = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);

    context.register_library_with_auth(&lib_a);
    context.register_library_with_auth(&lib_b);
    context.register_library_with_auth(&lib_c);

    // A initial.
    context.set_default_receive_library_with_auth(src_eid, &lib_a, 0);
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid, new_lib: lib_a.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid, timeout: None },
        ],
    );

    // Rotate A -> B with grace=1000 => keep A.
    context.set_default_receive_library_with_auth(src_eid, &lib_b, 1_000);
    let expected_timeout_b = Some(Timeout { lib: lib_a.clone(), expiry: t0 + 1_000 });
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid, new_lib: lib_b.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid, timeout: expected_timeout_b },
        ],
    );

    // Advance time, then rotate B -> C with grace=500 => must keep B (not A).
    let t1 = t0 + 10;
    env.ledger().with_mut(|li| {
        li.timestamp = t1;
    });
    context.set_default_receive_library_with_auth(src_eid, &lib_c, 500);
    let expected_timeout_c = Some(Timeout { lib: lib_b.clone(), expiry: t1 + 500 });
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid, new_lib: lib_c.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid, timeout: expected_timeout_c.clone() },
        ],
    );

    assert_eq!(endpoint_client.default_receive_library(&src_eid), Some(lib_c));
    assert_eq!(endpoint_client.default_receive_library_timeout(&src_eid), expected_timeout_c);
}

// EID scoping (defaults/timeouts must be independent per src_eid)
#[test]
fn test_set_default_receive_library_is_scoped_by_src_eid() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid_1 = context.eid;
    let src_eid_2 = context.eid + 1;

    let lib_1 = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid_1]);
    let lib_2 = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid_2]);

    context.register_library_with_auth(&lib_1);
    context.register_library_with_auth(&lib_2);

    context.set_default_receive_library_with_auth(src_eid_1, &lib_1, 0);
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid: src_eid_1, new_lib: lib_1.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid: src_eid_1, timeout: None },
        ],
    );

    context.set_default_receive_library_with_auth(src_eid_2, &lib_2, 0);
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid: src_eid_2, new_lib: lib_2.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid: src_eid_2, timeout: None },
        ],
    );

    assert_eq!(endpoint_client.default_receive_library(&src_eid_1), Some(lib_1));
    assert_eq!(endpoint_client.default_receive_library_timeout(&src_eid_1), None);

    assert_eq!(endpoint_client.default_receive_library(&src_eid_2), Some(lib_2));
    assert_eq!(endpoint_client.default_receive_library_timeout(&src_eid_2), None);
}

// Authorization (only owner)
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_default_receive_library_requires_owner_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let non_owner = Address::generate(env);

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&receive_lib);

    // Mock auth for the non-owner (not the owner).
    context.mock_auth(&non_owner, "set_default_receive_library", (&context.eid, &receive_lib, &0u64));

    // Should fail when a non-owner tries to set.
    endpoint_client.set_default_receive_library(&context.eid, &receive_lib, &0u64);
}

// Same value rejection (no-op is not allowed)
#[test]
fn test_set_default_receive_library_same_value() {
    let context = setup();
    let env = &context.env;

    // Create and register a valid receive lib that supports `context.eid`.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);

    context.register_library_with_auth(&receive_lib);
    context.set_default_receive_library_with_auth(context.eid, &receive_lib, 0);

    let result = try_set_default_receive_library_with_auth(&context, context.eid, &receive_lib, 0);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::SameValue.into());
}

// Successful update with SendAndReceive library type (valid for receive)
#[test]
fn test_set_default_receive_library_with_send_and_receive_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    // Create and register a SendAndReceive lib that supports `context.eid`.
    let send_and_receive_lib = context.setup_mock_message_lib(MessageLibType::SendAndReceive, vec![env, context.eid]);

    context.register_library_with_auth(&send_and_receive_lib);

    // Should succeed.
    context.set_default_receive_library_with_auth(context.eid, &send_and_receive_lib, 0);

    // Verify event emission.
    assert_contains_events(
        env,
        &endpoint_client.address,
        &[
            &DefaultReceiveLibrarySet { src_eid: context.eid, new_lib: send_and_receive_lib.clone() },
            &DefaultReceiveLibTimeoutSet { src_eid: context.eid, timeout: None },
        ],
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.default_receive_library(&context.eid), Some(send_and_receive_lib));
}
