// UI (trybuild) test: `#[ttl_configurable]` compiles with `#[ownable]` auth (no ttl_extendable).
//
// Purpose:
// - Mirrors the multisig pass case, ensuring ttl_configurable works in the ownable pattern too.
// - Type-checks the generated `TtlConfigurable` methods are callable without relying on other macros.

use common_macros::{ownable, ttl_configurable};
use soroban_sdk::{contract, contractimpl, Address, Env};
use utils::ttl_configurable::TtlConfig;

#[contract]
#[ttl_configurable]
#[ownable]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    pub fn smoke(env: Env) {
        let _cfg: (Option<TtlConfig>, Option<TtlConfig>) = Self::ttl_configs(&env);
        let _frozen: bool = Self::is_ttl_configs_frozen(&env);

        let none: Option<TtlConfig> = None;
        Self::set_ttl_configs(&env, &none, &none);
        Self::freeze_ttl_configs(&env);
    }
}

fn main() {}
