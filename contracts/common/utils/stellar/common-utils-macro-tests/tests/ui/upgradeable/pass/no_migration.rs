// UI (trybuild) test: `#[upgradeable(no_migration)]` compiles without manual UpgradeableInternal.
//
// Purpose:
// - Ensures the macro-generated no-op `UpgradeableInternal` impl exists downstream.
// - Ensures `Upgradeable` entrypoints are type-checkable.

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};

#[contract]
#[common_macros::ownable]
#[common_macros::upgradeable(no_migration)]
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
