use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

use crate::Timeout;
// Timeout::is_expired()
#[test]
fn test_timeout_is_expired_when_expiry_equals_current_timestamp() {
    let env = Env::default();
    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let timeout = Timeout { lib: Address::generate(&env), expiry: current_timestamp };

    // When expiry equals current timestamp, it should be considered expired
    assert!(timeout.is_expired(&env));
}

#[test]
fn test_timeout_is_expired_when_expiry_before_current_timestamp() {
    let env = Env::default();
    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let timeout = Timeout { lib: Address::generate(&env), expiry: current_timestamp - 1 };

    // When expiry is before current timestamp, it should be expired
    assert!(timeout.is_expired(&env));
}

#[test]
fn test_timeout_is_not_expired_when_expiry_after_current_timestamp() {
    let env = Env::default();
    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let timeout = Timeout { lib: Address::generate(&env), expiry: current_timestamp + 1 };

    // When expiry is after current timestamp, it should not be expired
    assert!(!timeout.is_expired(&env));
}

// Timeout::is_valid_for()
#[test]
fn test_timeout_is_valid_for_matching_library_and_not_expired() {
    let env = Env::default();
    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let lib = Address::generate(&env);
    let timeout = Timeout { lib: lib.clone(), expiry: current_timestamp + 1000 };

    // Should be valid: library matches and not expired
    assert!(timeout.is_valid_for(&env, &lib));
}

#[test]
fn test_timeout_is_not_valid_for_different_library() {
    let env = Env::default();
    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let lib_a = Address::generate(&env);
    let lib_b = Address::generate(&env);
    let timeout = Timeout { lib: lib_a.clone(), expiry: current_timestamp + 1000 };

    // Should not be valid: library doesn't match
    assert!(!timeout.is_valid_for(&env, &lib_b));
}

#[test]
fn test_timeout_is_not_valid_when_expired() {
    let env = Env::default();
    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let lib = Address::generate(&env);
    let timeout = Timeout {
        lib: lib.clone(),
        expiry: current_timestamp - 1, // Already expired
    };

    // Should not be valid: expired even though library matches
    assert!(!timeout.is_valid_for(&env, &lib));
}

#[test]
fn test_timeout_is_not_valid_when_expired_at_current_timestamp() {
    let env = Env::default();
    let current_timestamp = 1_700_000_000u64;
    env.ledger().with_mut(|li| li.timestamp = current_timestamp);

    let lib = Address::generate(&env);
    let timeout = Timeout {
        lib: lib.clone(),
        expiry: current_timestamp, // Expires exactly at current timestamp
    };

    // Should not be valid: expired (expiry <= current_timestamp)
    assert!(!timeout.is_valid_for(&env, &lib));
}
