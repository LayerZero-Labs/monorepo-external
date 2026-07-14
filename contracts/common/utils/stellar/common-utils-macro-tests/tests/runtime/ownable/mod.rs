use soroban_sdk::{contract, contractimpl, Address, Env};

mod initialization;
mod only_auth_guard;
mod ownership_transfer;
mod two_step_transfer;

/// Shared contract used by ownable runtime tests.
#[contract]
#[common_macros::ownable]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    #[common_macros::only_auth]
    pub fn guarded(env: &Env) {
        let _ = env;
    }
}
