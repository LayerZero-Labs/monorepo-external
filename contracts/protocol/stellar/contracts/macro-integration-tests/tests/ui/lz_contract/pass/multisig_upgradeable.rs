// UI (trybuild) test: `#[lz_contract(multisig, upgradeable)]` wrapper options compile.
//
// Purpose:
// - Ensures options can be combined and still produce a contract with upgrade entrypoints.

use soroban_sdk::{contractimpl, Bytes, BytesN, Env};
use utils::upgradeable::UpgradeableInternal;

#[common_macros::lz_contract(multisig, upgradeable)]
pub struct MyContract;

impl UpgradeableInternal for MyContract {
    type MigrationData = ();

    fn __migrate(env: &Env, _migration_data: &Self::MigrationData) {
        env.storage().instance().set(&soroban_sdk::Symbol::new(env, "migrated"), &true);
    }
}

#[contractimpl]
impl MyContract {
    pub fn smoke(env: Env) {
        let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let migration_data = Bytes::new(&env);
        Self::upgrade(&env, &hash);
        Self::migrate(&env, &migration_data);
    }
}

fn main() {}
