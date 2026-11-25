use common_macros::storage;
use soroban_sdk::{BytesN, Vec};

#[storage]
pub enum OneSigStorage {
    // ========================================================
    // Executor
    // ========================================================
    /// List of authorized executor public keys that can submit transactions.
    /// Stored in persistent storage and managed via `set_executor`.
    #[persistent(Vec<BytesN<32>>)]
    #[default(Vec::new(env))]
    Executors,

    /// Whether an authorized executor (or signer) is required to submit transactions.
    /// When false, anyone can execute; when true, only registered executors or signers can.
    #[instance(bool)]
    #[default(false)]
    ExecutorRequired,

    // ========================================================
    // Onesig
    // ========================================================
    /// Unique identifier for this OneSig instance.
    /// Should be set once in the constructor and never modified afterwards.
    #[instance(u64)]
    #[name("onesig_id")]
    OneSigId,

    /// Seed used as the EIP-712 domain separator for merkle root signature verification.
    /// Set in the constructor and updatable via `set_seed`.
    #[instance(BytesN<32>)]
    Seed,

    /// Monotonically increasing nonce to prevent transaction replay.
    /// Incremented after each successful transaction execution.
    #[instance(u64)]
    #[default(0)]
    Nonce,
}
