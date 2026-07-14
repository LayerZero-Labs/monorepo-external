// UI (trybuild) test: `#[lz_contract(upgradeable(no_migration))]` wrapper option compiles.
//
// Purpose:
// - Ensures `upgradeable(no_migration)` is accepted through the wrapper.
// - Ensures the auto-generated no-op `UpgradeableInternal` impl exists downstream.
// - Ensures upgrade entrypoints type-check.

use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};

#[common_macros::lz_contract(upgradeable(no_migration))]
pub struct MyContract;

#[contractimpl]
impl MyContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    pub fn smoke(env: Env) {
        let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let migration_data = Bytes::new(&env);
        Self::upgrade(&env, &hash);
        Self::migrate(&env, &migration_data);
    }
}

fn main() {}

