// UI (trybuild) test: `#[lz_contract(upgradeable)]` wrapper option compiles.
//
// Purpose:
// - Ensures the `upgradeable` option adds `#[upgradeable]` and the generated entrypoints type-check.

use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};
use utils::ttl_configurable::TtlConfig;
use utils::upgradeable::UpgradeableInternal;

#[common_macros::lz_contract(upgradeable)]
pub struct MyContract;

impl UpgradeableInternal for MyContract {
    type MigrationData = ();

    fn __migrate(env: &Env, _migration_data: &Self::MigrationData) {
        env.storage().instance().set(&soroban_sdk::Symbol::new(env, "migrated"), &true);
    }
}

#[contractimpl]
impl MyContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    pub fn smoke(env: Env) {
        // Wrapper always includes ttl_configurable + ttl_extendable.
        let _cfg: (Option<TtlConfig>, Option<TtlConfig>) = Self::ttl_configs(&env);
        Self::extend_instance_ttl(&env, 1, 2);

        let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let migration_data = Bytes::new(&env);
        Self::upgrade(&env, &hash);
        Self::migrate(&env, &migration_data);
    }
}

fn main() {}
