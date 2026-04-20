//! Shared types for LayerZero view contracts.

use soroban_sdk::{contracttype, BytesN, Env};

/// Represents the execution state of a cross-chain message.
///
/// Used by executors to determine when a message is ready to be delivered.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecutionState {
    /// Message is not ready for execution - waiting for verification.
    NotExecutable,
    /// Message is verified but cannot be executed yet (prior nonces pending).
    VerifiedButNotExecutable,
    /// Message is ready to be executed.
    Executable,
    /// Message has already been executed.
    Executed,
}

/// Represents the verification state of a cross-chain message at the ULN level.
///
/// Used by DVNs and executors to track verification progress.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VerificationState {
    /// DVNs are still collecting signatures/confirmations.
    Verifying,
    /// Has enough DVN confirmations, ready to be committed to endpoint.
    Verifiable,
    /// Already verified at the endpoint.
    Verified,
    /// Cannot be initialized (path blocked).
    NotInitializable,
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Returns the empty payload hash as BytesN<32>.
pub fn empty_payload_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

/// Returns the nil payload hash as BytesN<32>.
pub fn nil_payload_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0xffu8; 32])
}
