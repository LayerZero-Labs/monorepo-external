use super::IExecutor;
use soroban_sdk::{
    auth::{CustomAccountInterface, InvokerContractAuthEntry},
    contractclient, contracttype, Address, BytesN, Env, String, Symbol, Val, Vec,
};
use utils::multisig::MultiSig;

/// A single Soroban invocation that will be executed atomically inside a OneSig transaction.
#[contracttype]
#[derive(Clone, PartialEq)]
pub struct Call {
    /// Target contract address (mirrors `invoke_contract`'s `contractAddress`).
    pub to: Address,
    /// Method identifier that will be called on `to`.
    pub func: Symbol,
    /// ABI-encoded arguments forwarded to the target method.
    pub args: Vec<Val>,
    /// Sub-invocations that the OneSig contract must pre-authorize
    /// via `authorize_as_current_contract` before invoking this call.
    pub sub_invocations: Vec<InvokerContractAuthEntry>,
}

/// A merkle leaf describing the call that should be executed.
#[contracttype]
#[derive(Clone, PartialEq)]
pub struct Transaction {
    /// The single authorized invocation.
    pub call: Call,
    /// Merkle proof (sibling hashes) proving `call` belongs to an authorised root.
    pub proof: Vec<BytesN<32>>,
}

/// Account Abstraction payload used by `__check_auth` to validate an execution.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionAuthData {
    /// Approved merkle root covering the transaction.
    pub merkle_root: BytesN<32>,
    /// Unix timestamp (seconds) after which the root is invalid.
    pub expiry: u64,
    /// Merkle proof binding the calls to `merkle_root`.
    pub proof: Vec<BytesN<32>>,
    /// Threshold signatures (r‖s‖v) covering `merkle_root` and `expiry`.
    pub signatures: Vec<BytesN<65>>,
    /// Entity submitting the transaction (signer, executor, or permissionless).
    pub sender: Sender,
}

/// Represents the entity that is authorising the `__check_auth` invocation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Sender {
    /// A registered multisig signer acting as its own executor. Binds a secp256k1
    /// authorization signature to the ed25519 submitter (`delegate`), per the
    /// signer-as-executor spec.
    Signer(SignerExecutionProof),
    /// A registered executor (ed25519) submitting the transaction.
    /// The tuple is `(public_key, signature)` where the signature covers the Soroban payload.
    Executor(BytesN<32>, BytesN<64>),
    /// Permissionless execution (anyone may submit when `executor_required` is disabled).
    Permissionless,
}

/// Payload bound to a signer-as-executor submission.
///
/// Enforces the spec's "signer acting as executor" guarantee on Stellar:
/// a secp256k1 signer commits to the ed25519 submitter via `signature`, and the
/// submitter proves control of `delegate` via `delegate_proof`. `delegate_proof` is a
/// Soroban-specific field: `__check_auth` has no native `msg.sender`, so it is how this
/// implementation enforces the spec's `submitter == delegate` check.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerExecutionProof {
    /// secp256k1 signature (r‖s‖v, 65 bytes) over the EIP-712 digest of
    /// `SignerExecutionAuthorization { leafHash, merkleRoot, delegate, expiry }`.
    pub signature: BytesN<65>,
    /// Unix timestamp (seconds) after which `signature` can no longer be used.
    pub expiry: u64,
    /// ed25519 public key (32 bytes) the signer binds as the submitter.
    pub delegate: BytesN<32>,
    /// ed25519 signature (64 bytes) by `delegate` over the Soroban runtime
    /// payload hash — proves the submitter actually holds that key.
    pub delegate_proof: BytesN<64>,
}

/// Identifier used by `can_execute_transaction` to describe the caller.
/// Signers use Ethereum-style 20-byte addresses while executors use ed25519 public keys.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SenderKey {
    /// An Ethereum-style signer address (20 bytes, left-padded).
    Signer(BytesN<20>),
    /// An ed25519 executor public key (32 bytes).
    Executor(BytesN<32>),
}

/// Primary OneSig interface exposing merkle verification, transaction execution,
/// and read-only helpers used by off-chain clients.
#[contractclient(name = "OneSigClient")]
pub trait IOneSig: IExecutor + MultiSig + CustomAccountInterface {
    /// Updates the seed that is mixed into every merkle leaf.
    ///
    /// Changing the seed immediately invalidates all previously signed but unexecuted transactions.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `seed` - New 32-byte seed value.
    fn set_seed(env: &Env, seed: &BytesN<32>);

    /// Dispatches a list of external contract calls.
    ///
    /// All calls must succeed for the transaction to be successful.
    /// Revert behavior depends on the target contract's implementation.
    ///
    /// # Arguments
    /// * `calls` - List of calls to execute atomically.
    ///
    /// Security Note: This method is protected by `__check_auth`, which verifies that
    /// the transaction is authorised by a valid merkle root and signatures.
    fn execute_transaction(env: &Env, calls: &Vec<Call>);

    // ============================================================================
    // View Functions
    // ============================================================================

    /// Validates that a merkle root is still within its expiry window and that the supplied
    /// signatures meet the multisig threshold.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `merkle_root` - Authorised merkle root to validate.
    /// * `expiry` - Unix timestamp (seconds) at which the root expires.
    /// * `signatures` - Threshold signatures authorising the root.
    fn verify_merkle_root(
        env: &Env,
        merkle_root: &BytesN<32>,
        expiry: u64,
        signatures: &Vec<BytesN<65>>,
    );

    /// Checks that the provided transaction (call + proof) belongs to `merkle_root`
    /// and matches the current nonce.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `merkle_root` - Root that authorised the transaction.
    /// * `transaction` - Call and proof to verify.
    fn verify_transaction_proof(env: &Env, merkle_root: &BytesN<32>, transaction: &Transaction);

    /// Deterministically encodes the supplied nonce and call into the canonical merkle leaf hash.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `nonce` - Nonce representing execution order.
    /// * `call` - Call that should be included in the leaf.
    ///
    /// # Returns
    /// 32-byte keccak hash representing the canonical leaf.
    fn encode_leaf(env: &Env, nonce: u64, call: &Call) -> BytesN<32>;

    /// Returns true if the provided sender (signer or executor) is currently authorised to execute.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `sender` - Signer/executor identity to evaluate.
    fn can_execute_transaction(env: &Env, sender: &SenderKey) -> bool;

    /// Returns the immutable OneSig identifier configured at construction.
    fn onesig_id(env: &Env) -> u64;

    /// Returns the nonce of the next executable leaf. Increments after every successful execution.
    fn nonce(env: &Env) -> u64;

    /// Returns the current leaf seed.
    fn seed(env: &Env) -> BytesN<32>;

    /// Returns a semver string identifying the deployed contract build.
    fn version(env: &Env) -> String;

    /// Returns the version number of the merkle leaf encoding format.
    fn leaf_encoding_version(env: &Env) -> u32;
}
