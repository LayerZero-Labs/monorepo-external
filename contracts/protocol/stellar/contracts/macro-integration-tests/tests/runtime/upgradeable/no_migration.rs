// Runtime tests: `#[upgradeable(no_migration)]` macro variant.
//
// This ensures the macro-generated default `UpgradeableInternal` impl works end-to-end at runtime
// (i.e. no manual impl required), and that migrate clears the migrating flag.

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::ToXdr,
    Address, Env, IntoVal,
};
use utils::upgradeable::UpgradeableStorage;

#[contract]
#[common_macros::ownable]
#[common_macros::upgradeable(no_migration)]
pub struct NoMigrationContract;

#[contractimpl]
impl NoMigrationContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }
}

#[test]
fn no_migration_contract_can_migrate_and_clears_flag() {
    let env = Env::default();
    let contract_id = env.register(NoMigrationContract, ());
    let client = NoMigrationContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Allow migrate.
    env.as_contract(&contract_id, || {
        UpgradeableStorage::set_migrating(&env, &true);
    });

    // The no_migration impl uses MigrationData = (), so we pass XDR bytes for ().
    let migration_data = ().to_xdr(&env);

    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate",
                args: (&migration_data,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .migrate(&migration_data);

    env.as_contract(&contract_id, || {
        assert_eq!(UpgradeableStorage::migrating(&env), false);
    });
}

