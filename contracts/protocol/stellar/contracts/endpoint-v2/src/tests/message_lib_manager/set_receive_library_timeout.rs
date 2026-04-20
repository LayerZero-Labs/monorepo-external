use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address,
};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::EndpointError, events::ReceiveLibraryTimeoutSet, tests::endpoint_setup::setup,
    tests::endpoint_setup::TestSetup, MessageLibType, Timeout,
};

// Helpers
fn set_receive_library_timeout_with_auth(
    context: &TestSetup,
    caller: &Address,
    receiver: &Address,
    src_eid: u32,
    timeout: &Option<Timeout>,
) {
    context.mock_auth(caller, "set_receive_library_timeout", (caller, receiver, src_eid, timeout));
    context.endpoint_client.set_receive_library_timeout(caller, receiver, &src_eid, timeout);
}

// Authorization (OApp auth required)
#[test]
fn test_set_receive_library_timeout_requires_oapp_auth() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unauthorized = Address::generate(env);

    // Unauthorized should fail (caller is neither the OApp nor its delegate).
    let timeout = None::<Timeout>;
    let result = endpoint_client.try_set_receive_library_timeout(&unauthorized, &oapp, &context.eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::Unauthorized.into());
}

// Rejection when the resolved receive library is default (OApp must be non-default)
#[test]
fn test_set_receive_library_timeout_fails_for_default_receive_library() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    // Configure a default receive library, but do not set a custom one for the OApp.
    let default_receive_lib = context.setup_default_receive_lib(src_eid, 0);

    let timeout = Some(Timeout { lib: default_receive_lib, expiry: env.ledger().timestamp() + 1000 });
    context.mock_auth(&oapp, "set_receive_library_timeout", (&oapp, &oapp, &src_eid, &timeout));

    let result = endpoint_client.try_set_receive_library_timeout(&oapp, &oapp, &src_eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyNonDefaultLib.into());
}

// Invalid expiry rejection (must be strictly greater than current timestamp)
#[test]
fn test_set_receive_library_timeout_invalid_expiry_equal_timestamp() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);

    // Set a custom receive library so the OApp is non-default.
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    // expiry <= now is invalid.
    let timeout = Some(Timeout { lib: receive_lib.clone(), expiry: current_timestamp });
    context.mock_auth(&oapp, "set_receive_library_timeout", (&oapp, &oapp, &src_eid, &timeout));

    let result = endpoint_client.try_set_receive_library_timeout(&oapp, &oapp, &src_eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidExpiry.into());
}

#[test]
fn test_set_receive_library_timeout_invalid_expiry_past_timestamp() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);

    // Set a custom receive library so the OApp is non-default.
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    // expiry < now is invalid.
    let timeout = Some(Timeout { lib: receive_lib.clone(), expiry: current_timestamp - 1 });
    context.mock_auth(&oapp, "set_receive_library_timeout", (&oapp, &oapp, &src_eid, &timeout));

    let result = endpoint_client.try_set_receive_library_timeout(&oapp, &oapp, &src_eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::InvalidExpiry.into());
}

// Unregistered library rejection (timeout.lib must be registered)
#[test]
fn test_set_receive_library_timeout_unregistered_timeout_lib() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    // Create and register a valid receive lib for the custom receive_library.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);

    // Set a custom receive library so the OApp is non-default.
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    // Deployed contract, but not registered in endpoint storage.
    let unregistered_timeout_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);

    let timeout = Some(Timeout { lib: unregistered_timeout_lib, expiry: env.ledger().timestamp() + 1000 });
    context.mock_auth(&oapp, "set_receive_library_timeout", (&oapp, &oapp, &src_eid, &timeout));

    let result = endpoint_client.try_set_receive_library_timeout(&oapp, &oapp, &src_eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyRegisteredLib.into());
}

// Wrong library type rejection (must be Receive)
#[test]
fn test_set_receive_library_timeout_wrong_lib_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    // Create and register a valid receive lib for the custom receive_library.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);

    // Create and register a send-only lib.
    let send_lib = context.setup_mock_message_lib(MessageLibType::Send, vec![env, src_eid]);
    context.register_library_with_auth(&send_lib);

    // Set a custom receive library so the OApp is non-default.
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    let timeout = Some(Timeout { lib: send_lib, expiry: env.ledger().timestamp() + 1000 });
    context.mock_auth(&oapp, "set_receive_library_timeout", (&oapp, &oapp, &src_eid, &timeout));

    let result = endpoint_client.try_set_receive_library_timeout(&oapp, &oapp, &src_eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::OnlyReceiveLib.into());
}

// Unsupported EID rejection (timeout.lib must support src_eid)
#[test]
fn test_set_receive_library_timeout_unsupported_eid() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let unsupported_eid = context.eid + 1;

    // Custom receive library for `unsupported_eid` (so get_receive_library() is non-default and does not panic).
    let receive_lib_for_unsupported_eid =
        context.setup_mock_message_lib(MessageLibType::Receive, vec![env, unsupported_eid]);
    context.register_library_with_auth(&receive_lib_for_unsupported_eid);
    context.set_receive_library_with_auth(
        &oapp,
        &oapp,
        unsupported_eid,
        &Some(receive_lib_for_unsupported_eid.clone()),
        0,
    );

    // Timeout lib that does NOT support `unsupported_eid` (only supports `context.eid`).
    let receive_lib_for_context_eid = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, context.eid]);
    context.register_library_with_auth(&receive_lib_for_context_eid);

    let timeout = Some(Timeout { lib: receive_lib_for_context_eid, expiry: env.ledger().timestamp() + 1000 });
    context.mock_auth(&oapp, "set_receive_library_timeout", (&oapp, &oapp, &unsupported_eid, &timeout));

    let result = endpoint_client.try_set_receive_library_timeout(&oapp, &oapp, &unsupported_eid, &timeout);
    assert_eq!(result.err().unwrap().ok().unwrap(), EndpointError::UnsupportedEid.into());
}

// Successful update (state update + event emission)
#[test]
fn test_set_receive_library_timeout_success() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    // Create and register a valid receive lib.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);

    // Set a custom receive library so the OApp is non-default.
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    let timeout = Some(Timeout { lib: receive_lib.clone(), expiry: current_timestamp + grace_period });

    // Verify initial state via public interface.
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), None);

    // Should succeed.
    set_receive_library_timeout_with_auth(&context, &oapp, &oapp, src_eid, &timeout);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: timeout.clone() },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), timeout);
}

// Successful update with SendAndReceive library type (valid for receive)
#[test]
fn test_set_receive_library_timeout_success_with_send_and_receive_type() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    // Create and register a valid receive lib, and set it as the custom receive library.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    // Create and register a SendAndReceive lib for the timeout.
    let send_and_receive_lib = context.setup_mock_message_lib(MessageLibType::SendAndReceive, vec![env, src_eid]);
    context.register_library_with_auth(&send_and_receive_lib);

    let timeout = Some(Timeout { lib: send_and_receive_lib.clone(), expiry: current_timestamp + 1000 });

    // Should succeed.
    set_receive_library_timeout_with_auth(&context, &oapp, &oapp, src_eid, &timeout);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: timeout.clone() },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), timeout);
}

// Delegate authorization (delegate(oapp) is allowed)
#[test]
fn test_set_receive_library_timeout_allows_delegate() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let delegate = Address::generate(env);
    let src_eid = context.eid;

    // Set delegate for the OApp.
    let delegate_opt = Some(delegate.clone());
    context.mock_auth(&oapp, "set_delegate", (&oapp, &delegate_opt));
    endpoint_client.set_delegate(&oapp, &delegate_opt);

    // Create and register a valid receive lib, then set it as the custom receive library.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    let timeout = Some(Timeout { lib: receive_lib.clone(), expiry: env.ledger().timestamp() + 1000 });

    // Delegate should succeed.
    set_receive_library_timeout_with_auth(&context, &delegate, &oapp, src_eid, &timeout);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: timeout.clone() },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), timeout);
}

// Manual timeout extension keeps the previous custom library valid
#[test]
fn test_set_receive_library_timeout_keeps_old_custom_library_valid_until_expiry() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    // Create and register two receive libs.
    let old_custom = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    let new_custom = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&old_custom);
    context.register_library_with_auth(&new_custom);

    // Set old custom (no grace).
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(old_custom.clone()), 0);
    // Switch to new custom (no grace); old should not be valid via "current lib".
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(new_custom.clone()), 0);

    // Without any timeout set, old should be invalid now.
    assert!(!endpoint_client.is_valid_receive_library(&oapp, &src_eid, &old_custom));
    assert!(endpoint_client.is_valid_receive_library(&oapp, &src_eid, &new_custom));

    // Extend old custom validity via receive_library_timeout.
    let expiry = current_timestamp + 1000;
    let timeout = Some(Timeout { lib: old_custom.clone(), expiry });
    set_receive_library_timeout_with_auth(&context, &oapp, &oapp, src_eid, &timeout);

    // Old should now be valid until expiry, new remains valid.
    assert!(endpoint_client.is_valid_receive_library(&oapp, &src_eid, &old_custom));
    assert!(endpoint_client.is_valid_receive_library(&oapp, &src_eid, &new_custom));

    // After expiry, old becomes invalid again.
    env.ledger().with_mut(|li| li.timestamp = expiry);
    assert!(!endpoint_client.is_valid_receive_library(&oapp, &src_eid, &old_custom));
    assert!(endpoint_client.is_valid_receive_library(&oapp, &src_eid, &new_custom));
}

// Clearing timeout (None removes the timeout)
#[test]
fn test_set_receive_library_timeout_success_with_none() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    // Create and register a valid receive lib, then set it as the custom receive library.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    // Should succeed with None (clears the timeout).
    set_receive_library_timeout_with_auth(&context, &oapp, &oapp, src_eid, &None);

    // Verify event emission.
    assert_eq_event(
        env,
        &endpoint_client.address,
        ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: None },
    );

    // Verify state update via public interface.
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), None);
}

// Clearing an existing timeout (Some -> None)
#[test]
fn test_set_receive_library_timeout_clears_existing_timeout() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let oapp = Address::generate(env);
    let src_eid = context.eid;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    // Create and register a valid receive lib, then set it as the custom receive library.
    let receive_lib = context.setup_mock_message_lib(MessageLibType::Receive, vec![env, src_eid]);
    context.register_library_with_auth(&receive_lib);
    context.set_receive_library_with_auth(&oapp, &oapp, src_eid, &Some(receive_lib.clone()), 0);

    // First set a timeout.
    let timeout = Some(Timeout { lib: receive_lib.clone(), expiry: current_timestamp + 1000 });
    set_receive_library_timeout_with_auth(&context, &oapp, &oapp, src_eid, &timeout);
    assert_eq_event(
        env,
        &endpoint_client.address,
        ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: timeout.clone() },
    );
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), timeout);

    // Then clear it.
    set_receive_library_timeout_with_auth(&context, &oapp, &oapp, src_eid, &None);
    assert_eq_event(
        env,
        &endpoint_client.address,
        ReceiveLibraryTimeoutSet { receiver: oapp.clone(), eid: src_eid, timeout: None },
    );
    assert_eq!(endpoint_client.receive_library_timeout(&oapp, &src_eid), None);
}
