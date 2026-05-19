use crate::{
    eip712::build_eip712_digest, events::SeedSet, interfaces::IExecutor, storage::OneSigStorage,
    Call, IOneSig, OneSigError, SenderKey, Transaction,
};
use common_macros::{contract_impl, lz_contract, only_auth};
use soroban_sdk::{assert_with_error, xdr::ToXdr, BytesN, Env, String, Val, Vec};
use utils::{buffer_writer::BufferWriter, multisig};

const VERSION: &str = "0.0.1";
const LEAF_ENCODING_VERSION: u8 = 1;

#[lz_contract(multisig)]
pub struct OneSig;

#[contract_impl]
impl OneSig {
    /// Constructor to initialize the OneSig contract with initial state
    ///
    /// # Arguments
    /// * `onesig_id` - Unique identifier for this OneSig deployment
    /// * `seed` - Initial seed value for merkle root verification
    /// * `signers` - Array of initial signer addresses (32 bytes each, Ethereum addresses padded)
    /// * `threshold` - Number of signatures required for transaction execution
    /// * `executors` - Array of initial executor public keys (BytesN<32>)
    /// * `executor_required` - Whether executor permission is required for transaction execution
    pub fn __constructor(
        env: &Env,
        onesig_id: u64,
        seed: &BytesN<32>,
        signers: &Vec<BytesN<20>>,
        threshold: u32,
        executors: &Vec<BytesN<32>>,
        executor_required: bool,
    ) {
        multisig::init_multisig(env, signers, threshold);
        Self::init_executor(env, executors, executor_required);

        OneSigStorage::set_onesig_id(env, &onesig_id);
        OneSigStorage::set_seed(env, seed);
    }
}

#[contract_impl]
impl IOneSig for OneSig {
    /// Updates the seed used for EIP-712 digest construction and emits an event.
    #[only_auth]
    fn set_seed(env: &Env, seed: &BytesN<32>) {
        OneSigStorage::set_seed(env, seed);
        SeedSet { seed: seed.clone() }.publish(env);
    }

    /// Dispatches external contract calls. All security verification happens in `__check_auth`.
    /// Each call's `sub_invocations` are pre-authorized via `authorize_as_current_contract`
    /// immediately before invoking, enabling deeper sub-invocations (e.g. token transfers).
    #[only_auth]
    fn execute_transaction(env: &Env, calls: &Vec<Call>) {
        for call in calls.iter() {
            if !call.sub_invocations.is_empty() {
                env.authorize_as_current_contract(call.sub_invocations.clone());
            }
            env.invoke_contract::<Val>(&call.to, &call.func, call.args);
        }
    }

    // ============================================================================
    // Verification Functions
    // ============================================================================

    /// Verifies a merkle root by checking expiry and validating EIP-712 signatures.
    fn verify_merkle_root(
        env: &Env,
        merkle_root: &BytesN<32>,
        expiry: u64,
        signatures: &Vec<BytesN<65>>,
    ) {
        assert_with_error!(
            env,
            env.ledger().timestamp() <= expiry,
            OneSigError::MerkleRootExpired
        );

        // Verify signatures using EIP-712 digest
        let digest = build_eip712_digest(env, &Self::seed(env), merkle_root, expiry);
        Self::verify_signatures(env, &digest, signatures);
    }

    /// Verifies a transaction's merkle proof against the given root using the current nonce.
    fn verify_transaction_proof(env: &Env, merkle_root: &BytesN<32>, transaction: &Transaction) {
        let leaf = Self::encode_leaf(env, Self::nonce(env), &transaction.call);
        assert_with_error!(
            env,
            auth::verify_merkle_proof(env, &transaction.proof, merkle_root, &leaf),
            OneSigError::InvalidProofOrNonce
        );
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    /// Encodes a leaf node by serializing version, onesig ID, contract address, nonce, and call, then double-hashing with keccak256.
    fn encode_leaf(env: &Env, nonce: u64, call: &Call) -> BytesN<32> {
        // Build leaf data: [version (1 byte)][oneSigId (8 bytes)][contract (32 bytes)][nonce (8 bytes)][call]
        let mut writer = BufferWriter::new(env);
        let leaf_data = writer
            .write_u8(LEAF_ENCODING_VERSION)
            .write_u64(Self::onesig_id(env))
            .write_address_payload(&env.current_contract_address())
            .write_u64(nonce)
            .write_bytes(&call.to_xdr(env))
            .to_bytes();

        // Double hash: keccak256(keccak256(leaf_data))
        env.crypto()
            .keccak256(&env.crypto().keccak256(&leaf_data).into())
            .into()
    }

    /// Checks if the sender is authorized to execute a transaction (executor or signer when required).
    fn can_execute_transaction(env: &Env, sender: &SenderKey) -> bool {
        if !Self::executor_required(env) {
            return true;
        }

        match sender {
            SenderKey::Executor(pubkey) => Self::is_executor(env, pubkey),
            SenderKey::Signer(address) => Self::is_signer(env, address),
        }
    }

    /// Returns the unique identifier for this OneSig deployment.
    fn onesig_id(env: &Env) -> u64 {
        OneSigStorage::onesig_id(env).unwrap()
    }

    /// Returns the current transaction nonce.
    fn nonce(env: &Env) -> u64 {
        OneSigStorage::nonce(env)
    }

    /// Returns the current seed used for EIP-712 digest construction.
    fn seed(env: &Env) -> BytesN<32> {
        OneSigStorage::seed(env).unwrap()
    }

    /// Returns the contract version string.
    fn version(env: &Env) -> String {
        String::from_str(env, VERSION)
    }

    /// Returns the leaf encoding version used for merkle proof construction.
    fn leaf_encoding_version(_env: &Env) -> u32 {
        LEAF_ENCODING_VERSION as u32
    }
}

#[path = "auth.rs"]
mod auth;
#[path = "executor.rs"]
mod executor;
