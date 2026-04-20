// Runtime tests: `#[lz_contract(upgradeable(no_migration))]` wrapper macro.
//
// This ensures:
// - ownable auth is present (owner-based)
// - upgradeable entrypoints exist without requiring manual UpgradeableInternal impl
// - migrate obeys the migrating flag wiring (no-op migration)
// - ttl_configurable + ttl_extendable are still present

use soroban_sdk::{
    contractimpl,
    testutils::{storage::Instance as _, Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    xdr::ToXdr,
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal, Val,
};
use utils::upgradeable::UpgradeableStorage;

#[common_macros::lz_contract(upgradeable(no_migration))]
pub struct NoMigrationUpgradeableLzContract;

#[contractimpl]
impl NoMigrationUpgradeableLzContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }
}

#[test]
fn migrate_is_guarded_and_noop_migration_works() {
    let env = Env::default();
    let contract_id = env.register(NoMigrationUpgradeableLzContract, ());
    let client = NoMigrationUpgradeableLzContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);
    let migration_data = Val::VOID.to_xdr(&env);

    // Unauthorized migrate should fail.
    let unauthorized = client.try_migrate(&migration_data);
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Authorized migrate without migrating flag should fail with UpgradeableError.
    let no_flag = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate",
                args: (&migration_data,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_migrate(&migration_data);
    assert_eq!(no_flag.err().unwrap().ok().unwrap(), utils::errors::UpgradeableError::MigrationNotAllowed.into());

    // Set flag and migrate should succeed (no-op migration) and clear the flag.
    env.as_contract(&contract_id, || {
        UpgradeableStorage::set_migrating(&env, &true);
    });

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

#[test]
fn still_exposes_ttl_features() {
    let env = Env::default();
    let contract_id = env.register(NoMigrationUpgradeableLzContract, ());
    let client = NoMigrationUpgradeableLzContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // TTL-configurable read methods exist.
    let _cfg = client.ttl_configs();
    let _frozen = client.is_ttl_configs_frozen();

    // ttl_extendable entry exists and extends instance TTL.
    env.as_contract(&contract_id, || {
        env.storage().instance().set(&soroban_sdk::Symbol::new(&env, "seed"), &true);
    });
    let before = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    let before_seq = env.ledger().sequence();
    let live_until = before_seq + before;
    env.ledger().set_sequence_number(live_until.saturating_sub(1));
    client.extend_instance_ttl(&1, &50);
    let after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    assert_eq!(after, 50);
}
