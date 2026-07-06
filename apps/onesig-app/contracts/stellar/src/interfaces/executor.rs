use soroban_sdk::{contractclient, BytesN, Env, Vec};

/// Executor interface that controls the ed25519 allow list used for permissioned execution.
#[contractclient(name = "ExecutorClient")]
pub trait IExecutor {
    /// Adds or removes an executor public key. Only callable through the multisig itself.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `executor` - ed25519 public key to toggle.
    /// * `active` - `true` to add, `false` to remove.
    fn set_executor(env: &Env, executor: &BytesN<32>, active: bool);

    /// Sets whether executor authorisation is required. When `false`, anyone can execute a valid leaf.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `required` - `true` to require executors, `false` for permissionless mode.
    fn set_executor_required(env: &Env, required: bool);

    /// Returns the full list of executor public keys.
    fn get_executors(env: &Env) -> Vec<BytesN<32>>;

    /// Returns true if the supplied ed25519 public key is on the allow list.
    ///
    /// # Arguments
    /// * `env` - Soroban environment handle.
    /// * `executor` - ed25519 public key to check.
    fn is_executor(env: &Env, executor: &BytesN<32>) -> bool;

    /// Returns how many executors are currently active.
    fn total_executors(env: &Env) -> u32;

    /// Returns `true` if executors are currently required.
    fn executor_required(env: &Env) -> bool;
}
