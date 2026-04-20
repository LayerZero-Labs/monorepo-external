// UI (trybuild) test: `#[ttl_configurable]` and `#[ttl_extendable]` on a minimal contract compiles.
//
// Purpose:
// - Ensures `#[common_macros::ttl_configurable]` can be applied to a contract struct in a downstream crate.
// - Validates the macro-generated `utils::ttl::TtlConfigurable` trait impl exists and is callable.
// - Validates `#[ttl_extendable]` generates the `extend_instance_ttl` function.
// - Avoids snapshotting token output; compilation success + type-checking is the integration contract.
//
// Note: renamed from `minimal_contract.rs` to `basic.rs` for consistency.

use common_macros::{ownable, ttl_configurable, ttl_extendable};
use soroban_sdk::{contract, contractimpl, Address, Env};
use utils::ttl_configurable::TtlConfig;

#[contract]
#[ttl_configurable]
#[ttl_extendable]
#[ownable]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    // Provide a small init entry to type-check the injected ownable helper exists.
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    // Provide a method that type-checks the TtlConfigurable trait impl exists.
    pub fn smoke(env: Env) {
        // Read current TTL configs.
        let _cfg: (Option<TtlConfig>, Option<TtlConfig>) = Self::ttl_configs(&env);

        // Read frozen flag.
        let _frozen: bool = Self::is_ttl_configs_frozen(&env);

        // Type-check setter and freezer signatures.
        let none: Option<TtlConfig> = None;
        Self::set_ttl_configs(&env, &none, &none);
        Self::freeze_ttl_configs(&env);

        // Type-check the manual instance TTL extender from #[ttl_extendable].
        Self::extend_instance_ttl(&env, 1, 2);
    }
}

fn main() {}
