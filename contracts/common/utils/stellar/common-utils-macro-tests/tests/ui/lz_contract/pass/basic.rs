// UI (trybuild) test: `#[lz_contract]` wrapper macro compiles (default options).
//
// Purpose:
// - Ensures `#[common_macros::lz_contract]` expands to a usable `#[contract]` with
//   ttl_configurable + ttl_extendable + ownable.
//
// Note: renamed from `minimal_contract.rs` to `basic.rs` for consistency.

use soroban_sdk::{contractimpl, Address, Env};
use utils::ttl_configurable::TtlConfig;

#[common_macros::lz_contract]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    pub fn smoke(env: Env) {
        // Auth impl exists (provided by ownable/multisig, here: ownable).
        let _authorizer: Option<Address> = <Self as utils::auth::Auth>::authorizer(&env);
        let _owner: Option<Address> = <Self as utils::ownable::Ownable>::owner(&env);

        let _cfg: (Option<TtlConfig>, Option<TtlConfig>) = Self::ttl_configs(&env);
        let _frozen: bool = Self::is_ttl_configs_frozen(&env);

        // Type-check setters/signatures.
        let none: Option<TtlConfig> = None;
        Self::set_ttl_configs(&env, &none, &none);
        Self::freeze_ttl_configs(&env);

        // From ttl_extendable
        Self::extend_instance_ttl(&env, 1, 2);
    }

    // `only_auth` should be usable on lz_contract (it provides an Auth impl).
    #[common_macros::only_auth]
    pub fn protected(env: Env) {
        let _ = env;
    }
}

fn main() {}
