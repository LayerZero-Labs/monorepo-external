use message_lib_common::interfaces::ILayerZeroDVN;
use soroban_sdk::{auth::CustomAccountInterface, contractclient, contracttype, Address, BytesN, Env, Symbol, Val, Vec};
use utils::multisig::MultiSig;
use worker::Worker;

// ============================================================================
// Authentication Data Types
// ============================================================================

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Sender {
    /// No explicit sender (permissionless execution).
    None,
    /// A registered admin (ed25519) submitting the transaction.
    /// The tuple is `(public_key, signature)` where the signature covers the Soroban payload.
    Admin(BytesN<32>, BytesN<64>),
}

/// Authentication data for DVN contract transactions.
///
/// This struct is used with Soroban's custom account interface to authorize
/// transactions through a combination of admin signature and multisig quorum.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransactionAuthData {
    /// Verifier ID - must match the DVN's configured VID.
    pub vid: u32,
    /// Expiration timestamp (ledger time) after which this auth is invalid.
    pub expiration: u64,
    /// Signatures from multisig signers (secp256k1, 65 bytes each).
    pub signatures: Vec<BytesN<65>>,
    /// Entity submitting the transaction (admin, or permissionless).
    pub sender: Sender,
}

// ============================================================================
// Destination Configuration Types
// ============================================================================

/// Configuration for a destination chain.
///
/// Contains fee calculation parameters specific to each destination endpoint.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DstConfig {
    /// Gas for verification on the destination chain.
    pub gas: u128,
    /// Fee multiplier in basis points (10000 = 100%).
    /// If 0, the default multiplier from worker config is used.
    pub multiplier_bps: u32,
    /// Minimum fee margin in USD (scaled by native decimals rate).
    pub floor_margin_usd: u128,
}

/// Parameter for setting destination chain configuration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DstConfigParam {
    /// The destination endpoint ID.
    pub dst_eid: u32,
    /// The configuration for this destination.
    pub config: DstConfig,
}

/// Represents a single contract invocation for multisig authorization.
///
/// Used in `hash_call_data` to compute the hash that signers sign over.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Call {
    /// Target contract address.
    pub to: Address,
    /// Function name to invoke.
    pub func: Symbol,
    /// Function arguments.
    pub args: Vec<Val>,
}

/// DVN (Decentralized Verifier Network) contract interface.
///
/// Extends the LayerZero DVN interface with destination configuration management
/// and multisig capabilities for secure cross-chain message verification.
#[contractclient(name = "DVNClient")]
pub trait IDVN: ILayerZeroDVN + Worker + MultiSig + CustomAccountInterface {
    /// Dispatches a list of external contract calls.
    ///
    /// # Arguments
    /// * `calls` - List of calls to execute atomically
    fn execute_transaction(env: &Env, calls: &Vec<Call>);

    /// Sets the configuration for one or more destination chains.
    ///
    /// # Arguments
    /// * `admin` - The admin address (must provide authorization)
    /// * `params` - List of destination configurations to set
    fn set_dst_config(env: &Env, admin: &Address, params: &Vec<DstConfigParam>);

    /// Gets the configuration for a destination chain.
    ///
    /// # Arguments
    /// * `dst_eid` - The destination endpoint ID
    ///
    /// # Returns
    /// The destination configuration, or `None` if not configured
    fn dst_config(env: &Env, dst_eid: u32) -> Option<DstConfig>;

    /// Returns the verifier ID (VID) of this DVN.
    ///
    /// The VID is a unique identifier used in multisig authentication.
    fn vid(env: &Env) -> u32;

    /// Sets or clears the registered upgrader contract address.
    ///
    /// Protected by `#[only_auth]` (multisig quorum required).
    /// Pass `None` to remove the upgrader.
    fn set_upgrader(env: &Env, upgrader: &Option<Address>);

    /// Returns the registered upgrader contract address, if any.
    fn upgrader(env: &Env) -> Option<Address>;

    /// Computes the hash of call data for multisig signing.
    ///
    /// Off-chain signers use this to compute the hash they need to sign.
    /// The hash includes the VID, expiration, and the calls being authorized.
    ///
    /// # Arguments
    /// * `vid` - Verifier ID (must match contract's VID)
    /// * `expiration` - Expiration timestamp for the authorization
    /// * `calls` - The contract calls being authorized
    ///
    /// # Returns
    /// A 32-byte keccak256 hash to be signed by the multisig quorum
    fn hash_call_data(env: &Env, vid: u32, expiration: u64, calls: &Vec<Call>) -> BytesN<32>;
}
