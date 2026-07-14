// UI (trybuild) test: minimal upgradeable usage compiles.
//
// Purpose:
// - Verifies `#[common_macros::upgradeable]` can be applied on a contract struct.
// - Verifies the contract is required to implement `UpgradeableInternal`.
// - Verifies macro-generated `Upgradeable` entrypoints exist and are type-checkable.
//
// Note: renamed from `minimal_contract.rs` to `basic.rs` for consistency.

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};
use utils::upgradeable::UpgradeableInternal;

#[contract]
#[common_macros::ownable]
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
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    pub fn smoke(env: Env) {
        let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let migration_data = Bytes::new(&env);
        // Type-check generated entrypoints.
        Self::upgrade(&env, &hash);
        Self::migrate(&env, &migration_data);
    }
}

fn main() {}
