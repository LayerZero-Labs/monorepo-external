// UI (trybuild) test: `#[ttl_configurable]` compiles with `#[multisig]` auth.
//
// Purpose:
// - Ensures `#[common_macros::ttl_configurable]` works when the contract uses multisig auth.
// - Type-checks the generated `TtlConfigurable` trait methods are callable.

use common_macros::{multisig, ttl_configurable};
use soroban_sdk::{contract, contractimpl, Env};
use utils::ttl_configurable::TtlConfig;

#[contract]
#[ttl_configurable]
#[multisig]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn smoke(env: Env) {
        let _cfg: (Option<TtlConfig>, Option<TtlConfig>) = Self::ttl_configs(&env);
        let _frozen: bool = Self::is_ttl_configs_frozen(&env);

        let none: Option<TtlConfig> = None;
        Self::set_ttl_configs(&env, &none, &none);
        Self::freeze_ttl_configs(&env);
    }
}

fn main() {}
