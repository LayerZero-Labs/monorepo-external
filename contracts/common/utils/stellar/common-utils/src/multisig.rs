use crate::{
    self as utils, // Alias for #[storage] macro's generated `utils::ttl_configurable` path
    auth::Auth,
    errors::MultiSigError,
};
use common_macros::{contract_trait, storage};
use soroban_sdk::{assert_with_error, contractevent, Bytes, BytesN, Env, Vec};

// ===========================================================================
// MultiSig events
// ===========================================================================

/// Event emitted when a signer is added or removed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerSet {
    #[topic]
    pub signer: BytesN<20>,
    pub active: bool,
}

/// Event emitted when the signature threshold is changed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ThresholdSet {
    pub threshold: u32,
}

// ===========================================================================
// MultiSig storage
// ===========================================================================

/// Storage keys for MultiSig.
#[storage]
pub enum MultiSigStorage {
    /// List of authorized signers as Ethereum-style addresses (20 bytes).
    ///
    /// Practically, multisig has 2-5 signers, so storing them in a single `Vec` is fine.
    /// This makes `get_signers` trivial (just read the Vec), while `set_signer` is slightly
    /// more complex (read-modify-write). Since reads are frequent and writes are rare,
    /// this trade-off is acceptable.
    #[persistent(Vec<BytesN<20>>)]
    #[default(Vec::new(env))]
    Signers,

    /// Minimum number of valid signatures required to authorize operations (quorum).
    #[instance(u32)]
    #[default(0)]
    Threshold,
}

// ===========================================================================
// MultiSig trait with default implementation
// ===========================================================================

/// Trait for contracts with secp256k1 multisig signature verification.
///
/// Extends `Auth` to provide self-owning authorization. Contracts implementing
/// `MultiSig` should implement `Auth::authorizer()` to return `env.current_contract_address()`,
/// allowing the multisig quorum to serve as the authorizer for owner-protected operations.
#[contract_trait]
pub trait MultiSig: Auth {
    // ===========================================================================
    // Mutation functions, only callable by the contract itself
    // ===========================================================================

    /// Adds or removes a signer from the multisig. Requires owner authorization.
    fn set_signer(env: &soroban_sdk::Env, signer: &soroban_sdk::BytesN<20>, active: bool) {
        enforce_multisig_auth::<Self>(env);
        match active {
            true => add_signer(env, signer),
            false => remove_signer(env, signer),
        }
    }

    /// Sets the signature threshold (quorum). Requires owner authorization.
    fn set_threshold(env: &soroban_sdk::Env, threshold: u32) {
        enforce_multisig_auth::<Self>(env);
        set_threshold(env, threshold);
    }

    // ===========================================================================
    // View functions
    // ===========================================================================

    /// Returns all registered signers.
    fn get_signers(env: &soroban_sdk::Env) -> soroban_sdk::Vec<soroban_sdk::BytesN<20>> {
        MultiSigStorage::signers(env)
    }

    /// Returns the total number of registered signers.
    fn total_signers(env: &soroban_sdk::Env) -> u32 {
        MultiSigStorage::signers(env).len()
    }

    /// Checks if an address is a registered signer.
    fn is_signer(env: &soroban_sdk::Env, signer: &soroban_sdk::BytesN<20>) -> bool {
        MultiSigStorage::signers(env).iter().any(|s| &s == signer)
    }

    /// Returns the current signature threshold (quorum).
    fn threshold(env: &soroban_sdk::Env) -> u32 {
        MultiSigStorage::threshold(env)
    }

    // ===========================================================================
    // Verification functions
    // ===========================================================================

    /// Verifies signatures against the configured threshold.
    fn verify_signatures(
        env: &soroban_sdk::Env,
        digest: &soroban_sdk::BytesN<32>,
        signatures: &soroban_sdk::Vec<soroban_sdk::BytesN<65>>,
    ) {
        Self::verify_n_signatures(env, digest, signatures, MultiSigStorage::threshold(env));
    }

    /// Verifies signatures against a custom threshold.
    fn verify_n_signatures(
        env: &soroban_sdk::Env,
        digest: &soroban_sdk::BytesN<32>,
        signatures: &soroban_sdk::Vec<soroban_sdk::BytesN<65>>,
        threshold: u32,
    ) {
        assert_with_error!(env, threshold > 0, MultiSigError::ZeroThreshold);
        assert_with_error!(env, signatures.len() >= threshold, MultiSigError::SignatureError);

        let signers = MultiSigStorage::signers(env);
        let mut last_signer: Option<BytesN<20>> = None;
        for signature in signatures.iter() {
            let signer = recover_signer(env, digest, &signature);

            assert_with_error!(
                env,
                last_signer.as_ref().is_none_or(|last| &signer > last),
                MultiSigError::UnsortedSigners
            );
            assert_with_error!(env, signers.iter().any(|s| s == signer), MultiSigError::SignerNotFound);

            last_signer = Some(signer);
        }
    }
}

// ===========================================================================
// Public helper functions
// ===========================================================================

/// Initializes multisig with signers and threshold. Called from contract constructors.
pub fn init_multisig(env: &Env, signers: &Vec<BytesN<20>>, threshold: u32) {
    assert_with_error!(env, !MultiSigStorage::has_signers(env), MultiSigError::AlreadyInitialized);

    signers.iter().for_each(|signer| add_signer(env, &signer));
    set_threshold(env, threshold);
}

/// Recovers Ethereum-style signer address from secp256k1 signature (65 bytes: r + s + v).
pub fn recover_signer(env: &Env, digest: &BytesN<32>, signature: &BytesN<65>) -> BytesN<20> {
    let sig_bytes: Bytes = signature.into();

    // Extract recovery ID (v) - normalize from Ethereum's 27-30 range if needed
    let v = sig_bytes.get(64).unwrap();
    let recovery_id = if (27..=30).contains(&v) { v - 27 } else { v };

    // Extract r,s components (first 64 bytes)
    let sig_rs: BytesN<64> = sig_bytes.slice(0..64).try_into().unwrap();

    // Recover uncompressed public key (65 bytes with 0x04 prefix)
    let public_key = env.crypto_hazmat().secp256k1_recover(digest, &sig_rs, recovery_id as u32);

    // Derive Ethereum address: keccak256(pubkey[1..65])[12..32]
    let pubkey_body: Bytes = Bytes::from(public_key).slice(1..65);
    let hash: Bytes = env.crypto().keccak256(&pubkey_body).into();
    hash.slice(12..32).try_into().unwrap()
}

/// Enforces multisig authorization by requiring the contract's own address to authorize.
/// Panics with `InvalidAuthorizer` if the authorizer is not the contract's own address.
pub fn enforce_multisig_auth<T: MultiSig>(env: &Env) {
    // Ensure the authorizer is the contract's own address
    assert_with_error!(
        env,
        Some(env.current_contract_address()) == T::authorizer(env),
        MultiSigError::InvalidAuthorizer
    );
    env.current_contract_address().require_auth();
}

// ===========================================================================
// Private helper functions
// ===========================================================================

/// Adds a new signer to the multisig.
fn add_signer(env: &Env, signer: &BytesN<20>) {
    // Not allowed to add zero address as signer
    assert_with_error!(env, signer != &BytesN::from_array(env, &[0u8; 20]), MultiSigError::InvalidSigner);
    // Not allowed to add same signer twice
    let mut signers = MultiSigStorage::signers(env);
    assert_with_error!(env, !signers.iter().any(|s| &s == signer), MultiSigError::SignerAlreadyExists);

    // Add signer to list
    signers.push_back(signer.clone());
    MultiSigStorage::set_signers(env, &signers);

    SignerSet { signer: signer.clone(), active: true }.publish(env);
}

/// Removes a signer from the multisig.
fn remove_signer(env: &Env, signer: &BytesN<20>) {
    let mut signers = MultiSigStorage::signers(env);
    let index = signers.first_index_of(signer);
    // Not allowed to remove non-existent signer
    assert_with_error!(env, index.is_some(), MultiSigError::SignerNotFound);

    // Remove signer from list
    signers.remove(index.unwrap());

    // Not allowed to remove signer if it would violate the threshold
    assert_with_error!(
        env,
        signers.len() >= MultiSigStorage::threshold(env),
        MultiSigError::TotalSignersLessThanThreshold
    );

    // Update signers list
    MultiSigStorage::set_signers(env, &signers);

    SignerSet { signer: signer.clone(), active: false }.publish(env);
}

/// Sets the signature threshold (quorum).
fn set_threshold(env: &Env, threshold: u32) {
    // Not allowed to set threshold to zero
    assert_with_error!(env, threshold > 0, MultiSigError::ZeroThreshold);
    // Not allowed to set threshold to greater than the number of signers
    assert_with_error!(
        env,
        MultiSigStorage::signers(env).len() >= threshold,
        MultiSigError::TotalSignersLessThanThreshold
    );

    // Update threshold
    MultiSigStorage::set_threshold(env, &threshold);

    ThresholdSet { threshold }.publish(env);
}
