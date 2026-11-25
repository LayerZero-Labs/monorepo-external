use crate::onesig::OneSig;
use ed25519_dalek::SigningKey as Ed25519SigningKey;
use k256::ecdsa::{SigningKey, VerifyingKey};
use rand::thread_rng;
use soroban_sdk::{
    testutils::AuthorizedFunction, vec, Address, Bytes, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

/// Helper function to create a OneSig contract with default values
/// This allows tests to specify only the parameters they care about
pub fn create_onesig_with_defaults(
    env: &Env,
    onesig_id: Option<u64>,
    seed: Option<BytesN<32>>,
    signers: Option<soroban_sdk::Vec<BytesN<20>>>,
    threshold: Option<u32>,
    executors: Option<soroban_sdk::Vec<BytesN<32>>>,
    executor_required: Option<bool>,
) -> Address {
    let onesig_id = onesig_id.unwrap_or(0u64);
    let seed = seed.unwrap_or_else(|| BytesN::from_array(env, &[0u8; 32]));
    let signers = signers.unwrap_or_else(|| vec![env]);
    let threshold = threshold.unwrap_or(0u32);
    let executors = executors.unwrap_or_else(|| vec![env]);
    let executor_required = executor_required.unwrap_or(false);

    env.register(
        OneSig,
        (
            onesig_id,
            seed,
            signers,
            threshold,
            executors,
            executor_required,
        ),
    )
}

/// Helper for executor tests - minimal setup with just executors
#[allow(dead_code)] // Used across multiple test files (separate crates)
pub fn create_onesig_for_executor_tests(env: &Env) -> Address {
    // For executor tests, we need at least one signer (threshold > 0 requires signers)
    let dummy_signer = BytesN::from_array(env, &[1u8; 20]);
    let signers = vec![env, dummy_signer];
    create_onesig_with_defaults(env, None, None, Some(signers), Some(1u32), None, None)
}

/// Helper for multisig tests - start with one signer and threshold = 1
/// Note: Threshold must be > 0 and <= signer_count (consistent with EVM and Starknet)
#[allow(dead_code)] // Used across multiple test files (separate crates)
pub fn create_onesig_for_multisig_tests(env: &Env) -> Address {
    // Add at least one signer first, then set threshold = 1
    let dummy_signer = BytesN::from_array(env, &[1u8; 20]);
    let signers = vec![env, dummy_signer];
    create_onesig_with_defaults(env, None, None, Some(signers), Some(1u32), None, None)
}

/// Helper for onesig tests - minimal setup
#[allow(dead_code)] // Used across multiple test files (separate crates)
pub fn create_onesig_for_onesig_tests(env: &Env) -> Address {
    // For onesig tests, we need at least one signer (threshold > 0 requires signers)
    let dummy_signer = BytesN::from_array(env, &[1u8; 20]);
    let signers = vec![env, dummy_signer];
    create_onesig_with_defaults(env, None, None, Some(signers), Some(1u32), None, None)
}

// ============================================================================
// Ed25519 Keypair Helpers (for Executors)
// ============================================================================

/// Generate a random Ed25519 keypair
#[allow(dead_code)]
pub fn generate_ed25519_keypair() -> Ed25519SigningKey {
    Ed25519SigningKey::generate(&mut thread_rng())
}

/// Get the 32-byte public key from an Ed25519 keypair
#[allow(dead_code)]
pub fn ed25519_public_key(env: &Env, keypair: &Ed25519SigningKey) -> BytesN<32> {
    keypair.verifying_key().to_bytes().into_val(env)
}

// ============================================================================
// Secp256k1 Keypair Helpers (for Signers)
// ============================================================================

/// Generate a random secp256k1 keypair for signer tests
#[allow(dead_code)]
pub fn generate_secp256k1_keypair() -> SigningKey {
    SigningKey::random(&mut thread_rng())
}

/// Get the 20-byte Ethereum-style address from a secp256k1 public key
#[allow(dead_code)]
pub fn secp256k1_signer_address(env: &Env, signing_key: &SigningKey) -> BytesN<20> {
    let verifying_key = VerifyingKey::from(signing_key);
    let pubkey_bytes = verifying_key.to_encoded_point(false);
    let pubkey_uncompressed = pubkey_bytes.as_bytes();

    // Hash the public key (without the 0x04 prefix) using keccak256
    let pubkey_for_hash = Bytes::from_slice(env, &pubkey_uncompressed[1..65]);
    let hash = env.crypto().keccak256(&pubkey_for_hash);

    // Take the last 20 bytes as the Ethereum address
    let mut address = [0u8; 20];
    address.copy_from_slice(&hash.to_array()[12..32]);
    BytesN::from_array(env, &address)
}

/// Sign a digest with a secp256k1 key and return a 65-byte signature (r || s || v)
#[allow(dead_code)]
pub fn secp256k1_sign(env: &Env, signing_key: &SigningKey, digest: &BytesN<32>) -> BytesN<65> {
    let digest_array = digest.to_array();
    let (signature, recovery_id) = signing_key
        .sign_prehash_recoverable(&digest_array)
        .expect("signing should succeed");

    let signature_bytes = signature.to_bytes();
    let v = recovery_id.to_byte() + 27; // Convert to Ethereum-style v (27 or 28)

    // Build 65-byte signature: r (32) || s (32) || v (1)
    let mut sig_bytes = [0u8; 65];
    sig_bytes[0..64].copy_from_slice(&signature_bytes);
    sig_bytes[64] = v;

    BytesN::from_array(env, &sig_bytes)
}

// ============================================================================
// Shared Test Helpers
// ============================================================================

/// Generate a deterministic 20-byte signer address from a seed
#[allow(dead_code)]
pub fn generate_signer(env: &Env, seed: u64) -> BytesN<20> {
    let mut bytes = [0u8; 20];
    let seed_bytes = seed.to_be_bytes();
    bytes[0..8].copy_from_slice(&seed_bytes);
    BytesN::from_array(env, &bytes)
}

/// Generate a new executor key from a real Ed25519 keypair
#[allow(dead_code)]
pub fn new_executor_key(env: &Env) -> BytesN<32> {
    let keypair = generate_ed25519_keypair();
    ed25519_public_key(env, &keypair)
}

/// Assert that the latest auth call matches expected function and args
#[allow(dead_code)]
pub fn assert_latest_auth(env: &Env, contract_id: &Address, func: &str, expected_args: Vec<Val>) {
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (addr, invocation) = &auths[0];
    assert_eq!(addr, contract_id);
    assert!(invocation.sub_invocations.is_empty());
    match &invocation.function {
        AuthorizedFunction::Contract((id, symbol, args)) => {
            assert_eq!(id, contract_id);
            assert_eq!(symbol, &Symbol::new(env, func));
            assert_eq!(args, &expected_args);
        }
        _ => panic!("expected contract invocation auth"),
    }
}
