use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};

mod guard_behavior;

const MINTER_ROLE: &str = "minter";

#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    /// Test helper to deterministically grant the minter role to `minter`.
    ///
    /// This is intentionally unguarded; it is only used in integration tests.
    pub fn init(env: Env, admin: Address, minter: Address) {
        let role = Symbol::new(&env, MINTER_ROLE);
        utils::rbac::grant_role_no_auth(&env, &minter, &role, &admin);
    }

    #[common_macros::has_role(caller, MINTER_ROLE)]
    pub fn has_role_guarded(env: &Env, caller: Address) {
        let _ = (env, caller);
    }

    #[common_macros::only_role(caller, MINTER_ROLE)]
    pub fn only_role_guarded(env: &Env, caller: Address) {
        let _ = (env, caller);
    }
}

