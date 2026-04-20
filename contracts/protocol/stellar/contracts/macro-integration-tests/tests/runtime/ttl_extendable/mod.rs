use soroban_sdk::{contract, Env};

mod extend_instance_ttl;

/// Shared contract used by ttl_extendable runtime tests.
#[contract]
#[common_macros::ttl_extendable]
pub struct TestContract;

#[soroban_sdk::contractimpl]
impl TestContract {
    pub fn touch(env: Env) {
        // Create some instance storage state so instance TTL is meaningful.
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "touched"), &true);
    }
}
