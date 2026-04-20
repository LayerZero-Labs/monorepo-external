//! Unit tests for types module helper functions.

use soroban_sdk::{BytesN, Env};

use crate::types::{empty_payload_hash, nil_payload_hash};

// ============================================================================
// empty_payload_hash tests
// ============================================================================

#[test]
fn test_empty_payload_hash_returns_all_zeros() {
    let env = Env::default();
    let hash = empty_payload_hash(&env);

    // Verify it matches the expected constant
    assert_eq!(hash.to_array(), BytesN::from_array(&env, &[0u8; 32]));
}

// ============================================================================
// nil_payload_hash tests
// ============================================================================

#[test]
fn test_nil_payload_hash_returns_all_0xff() {
    let env = Env::default();
    let hash = nil_payload_hash(&env);

    // Verify it matches the expected constant
    assert_eq!(hash.to_array(), BytesN::from_array(&env, &[0xffu8; 32]));
}
