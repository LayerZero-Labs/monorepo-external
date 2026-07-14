// UI (trybuild) test: `#[upgradeable(rbac)]` compiles with UpgradeableRbac.
//
// Purpose:
// - Ensures the macro generates `impl UpgradeableRbac` when `rbac` is specified.
// - Verifies upgrade/migrate take the extra `operator` parameter.

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};
use utils::rbac::{grant_role_no_auth, RoleBasedAccessControl};
use utils::upgradeable::{UpgradeableInternal, UPGRADER_ROLE};

#[contract]
#[common_macros::ownable]
#[common_macros::upgradeable(rbac)]
pub struct MyContract;

impl UpgradeableInternal for MyContract {
    type MigrationData = ();

    fn __migrate(_env: &Env, _migration_data: &Self::MigrationData) {}
}

#[contractimpl(contracttrait)]
impl RoleBasedAccessControl for MyContract {}

#[contractimpl]
impl MyContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }

    pub fn init_upgrader(env: Env, operator: Address) {
        let upgrader_role = soroban_sdk::Symbol::new(&env, UPGRADER_ROLE);
        grant_role_no_auth(&env, &operator, &upgrader_role, &env.current_contract_address());
    }

    pub fn smoke(env: Env, operator: Address) {
        let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let migration_data = Bytes::new(&env);
        Self::upgrade(&env, &hash, &operator);
        Self::migrate(&env, &migration_data, &operator);
    }
}

fn main() {}
