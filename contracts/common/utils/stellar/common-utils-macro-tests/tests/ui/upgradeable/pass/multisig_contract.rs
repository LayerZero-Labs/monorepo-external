// UI (trybuild) test: upgradeable usage compiles with multisig auth.
//
// Purpose:
// - Ensures `#[common_macros::upgradeable]` works when the contract uses `#[multisig]`.
// - Verifies macro-generated `Upgradeable` entrypoints exist and are callable.

use soroban_sdk::{contract, contractimpl, Bytes, BytesN, Env};
use utils::upgradeable::UpgradeableInternal;

#[contract]
#[common_macros::multisig]
#[common_macros::upgradeable]
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
