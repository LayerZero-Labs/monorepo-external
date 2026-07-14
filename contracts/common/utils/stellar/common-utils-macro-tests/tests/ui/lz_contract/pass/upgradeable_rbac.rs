// UI (trybuild) test: `#[lz_contract(upgradeable)]` compiles with RBAC.
//
// Purpose:
// - Ensures lz_contract upgradeable wrapper can coexist with RoleBasedAccessControl.

use soroban_sdk::{contractimpl, Address, Bytes, BytesN, Env};
use utils::rbac::{grant_role_no_auth, RoleBasedAccessControl};
use utils::ttl_configurable::TtlConfig;
use utils::upgradeable::UpgradeableInternal;

#[common_macros::lz_contract(upgradeable)]
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

    pub fn smoke(env: Env, operator: Address) {
        // Smoke-use RBAC helper (doesn't execute in trybuild).
        let role = soroban_sdk::Symbol::new(&env, "SOME_ROLE");
        grant_role_no_auth(&env, &operator, &role, &env.current_contract_address());

        let _cfg: (Option<TtlConfig>, Option<TtlConfig>) = Self::ttl_configs(&env);
        Self::extend_instance_ttl(&env, 1, 2);

        let hash = BytesN::<32>::from_array(&env, &[0u8; 32]);
        let migration_data = Bytes::new(&env);
        Self::upgrade(&env, &hash);
        Self::migrate(&env, &migration_data);
    }
}

fn main() {}
