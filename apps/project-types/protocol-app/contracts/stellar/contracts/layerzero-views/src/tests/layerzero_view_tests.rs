//! Tests for unified LayerZeroView contract.
//!
//! These tests verify:
//!
//! **Endpoint View Functions:**
//! - `initializable`: Check if path can be initialized
//! - `verifiable`: Check if message can be verified at endpoint
//! - `executable`: Get execution state (NotExecutable, VerifiedButNotExecutable, Executable, Executed)
//!
//! **ULN View Functions:**
//! - `uln_verifiable`: Get combined verification state (NotInitializable, Verifying, Verifiable, Verified)

use endpoint_v2::Origin;
use soroban_sdk::{testutils::Address as _, BytesN};

use crate::{
    types::{empty_payload_hash, nil_payload_hash, ExecutionState, VerificationState},
    LayerZeroViewError,
};

use super::setup::{
    address_to_bytes32, create_test_packet_header, create_test_packet_header_with_eid, create_test_payload_hash, setup,
    LOCAL_EID, REMOTE_EID,
};

// ============================================================================
// Basic Initialization Tests
// ============================================================================

#[test]
fn test_layerzero_view_initialization() {
    let test_setup = setup();

    // Verify the view contract is initialized correctly
    assert_eq!(test_setup.view_client.endpoint(), test_setup.endpoint);
    assert_eq!(test_setup.view_client.uln302(), test_setup.uln302);
    assert_eq!(test_setup.view_client.local_eid(), LOCAL_EID);
}

// ============================================================================
// Initializable Tests
// ============================================================================

#[test]
fn test_initializable_returns_true() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Set initializable to true
    test_setup.set_initializable(&receiver, REMOTE_EID, &sender, true);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };

    assert!(test_setup.view_client.initializable(&origin, &receiver));
}

#[test]
fn test_initializable_returns_false() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Set initializable to false
    test_setup.set_initializable(&receiver, REMOTE_EID, &sender, false);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };

    assert!(!test_setup.view_client.initializable(&origin, &receiver));
}

// ============================================================================
// Verifiable Tests (Endpoint)
// ============================================================================

#[test]
fn test_verifiable_when_library_valid_and_endpoint_verifiable() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Set up receive library and verifiable
    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, true);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };
    let payload_hash = create_test_payload_hash(&test_setup.env);

    assert!(test_setup.view_client.verifiable(&origin, &receiver, &test_setup.uln302, &payload_hash));
}

#[test]
fn test_not_verifiable_with_invalid_library() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);
    let invalid_lib = soroban_sdk::Address::generate(&test_setup.env);

    // Set up different receive library
    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, true);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };
    let payload_hash = create_test_payload_hash(&test_setup.env);

    // Using wrong library should fail
    assert!(!test_setup.view_client.verifiable(&origin, &receiver, &invalid_lib, &payload_hash));
}

#[test]
fn test_not_verifiable_with_empty_payload_hash() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, true);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };

    // Empty payload hash is not allowed
    let empty_hash = empty_payload_hash(&test_setup.env);

    assert!(!test_setup.view_client.verifiable(&origin, &receiver, &test_setup.uln302, &empty_hash));
}

#[test]
fn test_not_verifiable_when_endpoint_not_verifiable() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, false);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };
    let payload_hash = create_test_payload_hash(&test_setup.env);

    assert!(!test_setup.view_client.verifiable(&origin, &receiver, &test_setup.uln302, &payload_hash));
}

// ============================================================================
// Executable Tests
// ============================================================================

#[test]
fn test_executable_state_not_executable() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };

    // No payload hash set, nonce > inbound_nonce
    let state = test_setup.view_client.executable(&origin, &receiver);
    assert_eq!(state, ExecutionState::NotExecutable);
}

#[test]
fn test_executable_state_verified_but_not_executable() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Set payload hash for nonce 2 (gap - nonce 1 not verified)
    let payload_hash = create_test_payload_hash(&test_setup.env);
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 2, &Some(payload_hash));

    // inbound_nonce is still 0, so nonce 2 is not executable (prior nonces pending)
    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 2 };

    let state = test_setup.view_client.executable(&origin, &receiver);
    assert_eq!(state, ExecutionState::VerifiedButNotExecutable);
}

#[test]
fn test_executable_state_executable() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Set payload hash and inbound_nonce to make it executable
    let payload_hash = create_test_payload_hash(&test_setup.env);
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 1, &Some(payload_hash));
    test_setup.set_inbound_nonce(&receiver, REMOTE_EID, &sender, 1);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };

    let state = test_setup.view_client.executable(&origin, &receiver);
    assert_eq!(state, ExecutionState::Executable);
}

#[test]
fn test_executable_state_executed() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Clear payload hash (None) and set inbound_nonce >= nonce = Executed
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 1, &None);
    test_setup.set_inbound_nonce(&receiver, REMOTE_EID, &sender, 1);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };

    let state = test_setup.view_client.executable(&origin, &receiver);
    assert_eq!(state, ExecutionState::Executed);
}

#[test]
fn test_executable_state_not_executable_when_nilified() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Set NIL payload hash
    let nil_hash = nil_payload_hash(&test_setup.env);
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 1, &Some(nil_hash));
    test_setup.set_inbound_nonce(&receiver, REMOTE_EID, &sender, 1);

    let origin = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };

    // NIL hash means message was nilified, not executable
    let state = test_setup.view_client.executable(&origin, &receiver);
    assert_eq!(state, ExecutionState::NotExecutable);
}

#[test]
fn test_executable_multiple_nonces_in_sequence() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    let payload_hash_1 = create_test_payload_hash(&test_setup.env);
    let payload_hash_2 = BytesN::from_array(&test_setup.env, &[0xAB; 32]);
    let payload_hash_3 = BytesN::from_array(&test_setup.env, &[0xCD; 32]);

    // Set payload hashes for nonces 1, 2, 3
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 1, &Some(payload_hash_1));
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 2, &Some(payload_hash_2));
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 3, &Some(payload_hash_3));

    // Only nonce 1 is executable (inbound_nonce = 1)
    test_setup.set_inbound_nonce(&receiver, REMOTE_EID, &sender, 1);

    let origin_1 = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 1 };
    let origin_2 = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 2 };
    let origin_3 = Origin { src_eid: REMOTE_EID, sender: address_to_bytes32(&sender), nonce: 3 };

    assert_eq!(test_setup.view_client.executable(&origin_1, &receiver), ExecutionState::Executable);
    assert_eq!(test_setup.view_client.executable(&origin_2, &receiver), ExecutionState::VerifiedButNotExecutable);
    assert_eq!(test_setup.view_client.executable(&origin_3, &receiver), ExecutionState::VerifiedButNotExecutable);

    // Now execute nonce 1 (clear payload hash, advance inbound_nonce)
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 1, &None);
    test_setup.set_inbound_nonce(&receiver, REMOTE_EID, &sender, 2);

    assert_eq!(test_setup.view_client.executable(&origin_1, &receiver), ExecutionState::Executed);
    assert_eq!(test_setup.view_client.executable(&origin_2, &receiver), ExecutionState::Executable);
    assert_eq!(test_setup.view_client.executable(&origin_3, &receiver), ExecutionState::VerifiedButNotExecutable);
}

// ============================================================================
// ULN Verifiable - NotInitializable State Tests
// ============================================================================

#[test]
fn test_uln_verifiable_state_not_initializable_invalid_eid() {
    let test_setup = setup();
    let env = &test_setup.env;

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(env);

    // Create packet with invalid dst_eid (not matching local_eid)
    let invalid_eid = 99999u32;
    let packet_header = create_test_packet_header_with_eid(env, &receiver, &sender, 1, invalid_eid);
    let payload_hash = create_test_payload_hash(env);

    let result = test_setup.view_client.try_uln_verifiable(&packet_header, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), LayerZeroViewError::InvalidEID.into());
}

#[test]
fn test_uln_verifiable_state_not_initializable_path_blocked() {
    let test_setup = setup();
    let env = &test_setup.env;

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(env);

    // Path is not initializable
    test_setup.set_initializable(&receiver, REMOTE_EID, &sender, false);

    let packet_header = create_test_packet_header(env, &receiver, &sender, 1);
    let payload_hash = create_test_payload_hash(env);

    let state = test_setup.view_client.uln_verifiable(&packet_header, &payload_hash);
    assert_eq!(state, VerificationState::NotInitializable);
}

// ============================================================================
// ULN Verifiable - Verifying State Tests
// ============================================================================

#[test]
fn test_uln_verifiable_state_verifying() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Initialize path
    test_setup.set_initializable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302.clone());

    let packet_header = create_test_packet_header(&test_setup.env, &receiver, &sender, 1);
    let payload_hash = create_test_payload_hash(&test_setup.env);

    // ULN302 verifiable returns false (default) - still collecting DVN signatures
    // Note: set_uln_verifiable not called, defaults to false
    let state = test_setup.view_client.uln_verifiable(&packet_header, &payload_hash);
    assert_eq!(state, VerificationState::Verifying);
}

// ============================================================================
// ULN Verifiable - Verifiable State Tests
// ============================================================================

#[test]
fn test_uln_verifiable_state_verifiable() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Initialize path
    test_setup.set_initializable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302.clone());

    let packet_header = create_test_packet_header(&test_setup.env, &receiver, &sender, 1);
    let payload_hash = create_test_payload_hash(&test_setup.env);

    // ULN302 verifiable returns true - has enough DVN confirmations
    test_setup.set_uln_verifiable(&packet_header, &payload_hash, true);

    let state = test_setup.view_client.uln_verifiable(&packet_header, &payload_hash);
    assert_eq!(state, VerificationState::Verifiable);
}

// ============================================================================
// ULN Verifiable - Verified State Tests
// ============================================================================

#[test]
fn test_uln_verifiable_state_verified_already_committed() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Initialize path
    test_setup.set_initializable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302.clone());

    let payload_hash = create_test_payload_hash(&test_setup.env);
    let packet_header = create_test_packet_header(&test_setup.env, &receiver, &sender, 1);

    // Set the payload hash in endpoint (simulating verification has been committed)
    test_setup.set_payload_hash(&receiver, REMOTE_EID, &sender, 1, &Some(payload_hash.clone()));

    // Message is already verified at endpoint
    let state = test_setup.view_client.uln_verifiable(&packet_header, &payload_hash);
    assert_eq!(state, VerificationState::Verified);
}

// ============================================================================
// ULN Verifiable - Multiple Messages Tests
// ============================================================================

#[test]
fn test_uln_verifiable_state_multiple_messages_different_nonces() {
    let test_setup = setup();

    let receiver = test_setup.register_oapp();
    let sender = soroban_sdk::Address::generate(&test_setup.env);

    // Initialize path
    test_setup.set_initializable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_verifiable(&receiver, REMOTE_EID, &sender, true);
    test_setup.set_receive_library(&receiver, REMOTE_EID, &test_setup.uln302.clone());

    let packet_header_1 = create_test_packet_header(&test_setup.env, &receiver, &sender, 1);
    let packet_header_2 = create_test_packet_header(&test_setup.env, &receiver, &sender, 2);
    let payload_hash_1 = create_test_payload_hash(&test_setup.env);
    let payload_hash_2 = BytesN::from_array(&test_setup.env, &[0xAB; 32]);

    // Only message 1 is verifiable at ULN
    test_setup.set_uln_verifiable(&packet_header_1, &payload_hash_1, true);
    // Message 2 defaults to false (Verifying)

    // Nonce 1 is verifiable, nonce 2 is still verifying
    let state_1 = test_setup.view_client.uln_verifiable(&packet_header_1, &payload_hash_1);
    let state_2 = test_setup.view_client.uln_verifiable(&packet_header_2, &payload_hash_2);

    assert_eq!(state_1, VerificationState::Verifiable);
    assert_eq!(state_2, VerificationState::Verifying);
}
