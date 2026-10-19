use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address,
};

use crate::{tests::endpoint_setup::setup, Timeout};

// Default receive library rotation (default timeout / grace period)
#[test]
fn test_is_valid_receive_library_allows_old_default_receive_library_within_grace_period() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Set an initial default receive library, then rotate it with a grace period.
    let old_default = context.setup_default_receive_lib(src_eid, 0);
    let new_default = context.setup_default_receive_lib(src_eid, grace_period);

    // Old default is still valid due to the default timeout (grace period).
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_default));
    // Current default is always valid.
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &new_default));
}

#[test]
fn test_is_valid_receive_library_rejects_old_default_receive_library_after_grace_period_expires() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    let old_default = context.setup_default_receive_lib(src_eid, 0);
    let new_default = context.setup_default_receive_lib(src_eid, grace_period);

    // Expire the timeout: expiry <= timestamp means expired.
    env.ledger().with_mut(|li| li.timestamp = current_timestamp + grace_period);

    assert!(!endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_default));
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &new_default));
}

#[test]
fn test_is_valid_receive_library_allows_timeout_library_set_by_owner() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let now = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = now);

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Configure a default receive library.
    let default_receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // Owner sets a default receive library timeout for a different (registered) library.
    let timeout_lib = context.setup_mock_receive_lib(vec![env, src_eid]);
    context.register_library_with_auth(&timeout_lib);
    let timeout = Some(Timeout { lib: timeout_lib.clone(), expiry: now + 1000 });
    context.mock_owner_auth("set_default_receive_lib_timeout", (&src_eid, &timeout));
    endpoint_client.set_default_receive_lib_timeout(&src_eid, &timeout);

    // The current default is always valid, and the timeout lib becomes valid until expiry.
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &default_receive_lib));
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &timeout_lib));

    // Other registered libs are still invalid.
    let other_lib = context.setup_mock_receive_lib(vec![env, src_eid]);
    context.register_library_with_auth(&other_lib);
    assert!(!endpoint_client.is_valid_receive_library(&receiver, &src_eid, &other_lib));
}

// Custom receive library rotation (per-receiver timeout / grace period)
#[test]
fn test_is_valid_receive_library_allows_old_custom_receive_library_within_grace_period() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Set old custom lib (no grace), then rotate to a new custom lib with grace.
    let old_custom = context.setup_receive_library(&receiver, &receiver, src_eid, 0);
    let new_custom = context.setup_receive_library(&receiver, &receiver, src_eid, grace_period);

    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_custom));
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &new_custom));
}

#[test]
fn test_is_valid_receive_library_rejects_old_custom_receive_library_after_grace_period_expires() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    let old_custom = context.setup_receive_library(&receiver, &receiver, src_eid, 0);
    let new_custom = context.setup_receive_library(&receiver, &receiver, src_eid, grace_period);

    // Expire the timeout.
    env.ledger().with_mut(|li| li.timestamp = current_timestamp + grace_period);

    assert!(!endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_custom));
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &new_custom));
}

// Unrelated libraries are rejected unless covered by a matching timeout
#[test]
fn test_is_valid_receive_library_rejects_unrelated_library_without_timeout() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Configure a default receive library.
    let default_receive_lib = context.setup_default_receive_lib(src_eid, 0);

    // A registered, but unrelated, library should not be valid if no timeout applies.
    let unrelated_lib = context.setup_mock_receive_lib(vec![env, src_eid]);
    context.register_library_with_auth(&unrelated_lib);

    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &default_receive_lib));
    assert!(!endpoint_client.is_valid_receive_library(&receiver, &src_eid, &unrelated_lib));
}

#[test]
fn test_is_valid_receive_library_rejects_unrelated_library_even_when_default_timeout_exists() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Rotate default receive library with grace so a default timeout exists.
    let old_default = context.setup_default_receive_lib(src_eid, 0);
    let new_default = context.setup_default_receive_lib(src_eid, grace_period);

    // A registered, unrelated library must not be valid unless it matches the timeout's lib.
    let unrelated_lib = context.setup_mock_receive_lib(vec![env, src_eid]);
    context.register_library_with_auth(&unrelated_lib);

    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_default));
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &new_default));
    assert!(!endpoint_client.is_valid_receive_library(&receiver, &src_eid, &unrelated_lib));
}

#[test]
fn test_is_valid_receive_library_rejects_unrelated_library_even_when_custom_timeout_exists() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    let grace_period = 1_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Rotate a custom receive library with grace so a per-receiver timeout exists.
    let old_custom = context.setup_receive_library(&receiver, &receiver, src_eid, 0);
    let new_custom = context.setup_receive_library(&receiver, &receiver, src_eid, grace_period);

    let unrelated_lib = context.setup_mock_receive_lib(vec![env, src_eid]);
    context.register_library_with_auth(&unrelated_lib);

    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_custom));
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &new_custom));
    assert!(!endpoint_client.is_valid_receive_library(&receiver, &src_eid, &unrelated_lib));
}

// Custom configuration ignores the default receive library timeout
#[test]
fn test_is_valid_receive_library_custom_configuration_ignores_default_timeout() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let grace_period = 1_000u64;
    let src_eid = context.eid;
    let receiver = Address::generate(env);

    // Rotate default receive library with grace, which would normally allow old_default.
    let old_default = context.setup_default_receive_lib(src_eid, 0);
    let _ = context.setup_default_receive_lib(src_eid, grace_period);

    // Sanity: old default is valid for a receiver when the receiver uses default.
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_default));

    // Receiver switches to a custom receive library. From now on, default timeout must NOT apply.
    let custom_receive_lib = context.setup_receive_library(&receiver, &receiver, src_eid, 0);

    // After custom is configured, old_default is no longer valid (no per-receiver timeout was set for it).
    assert!(!endpoint_client.is_valid_receive_library(&receiver, &src_eid, &old_default));
    assert!(endpoint_client.is_valid_receive_library(&receiver, &src_eid, &custom_receive_lib));
}

// Custom library timeout is isolated per receiver
#[test]
fn test_is_valid_receive_library_custom_timeout_isolated_per_receiver() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let grace_period = 1_000u64;
    let src_eid = context.eid;
    let receiver_a = Address::generate(env);
    let receiver_b = Address::generate(env);

    // Ensure receiver_b has a valid default receive library so the view does not panic.
    context.setup_default_receive_lib(src_eid, 0);

    // Receiver A rotates custom lib with grace.
    let old_custom = context.setup_receive_library(&receiver_a, &receiver_a, src_eid, 0);
    let new_custom = context.setup_receive_library(&receiver_a, &receiver_a, src_eid, grace_period);

    // Receiver A: old is valid within grace.
    assert!(endpoint_client.is_valid_receive_library(&receiver_a, &src_eid, &old_custom));
    assert!(endpoint_client.is_valid_receive_library(&receiver_a, &src_eid, &new_custom));

    // Receiver B: no receive library config => old_custom is not valid.
    assert!(!endpoint_client.is_valid_receive_library(&receiver_b, &src_eid, &old_custom));
}
