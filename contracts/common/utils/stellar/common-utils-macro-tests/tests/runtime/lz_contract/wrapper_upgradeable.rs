// Runtime tests: `#[lz_contract(upgradeable)]` wrapper macro.
//
// This ensures:
// - ownable auth is present (owner-based)
// - upgradeable entrypoints exist and are guarded by `only_auth`
// - migrate obeys the migrating flag wiring

use soroban_sdk::{
    contractimpl,
    testutils::{storage::Instance as _, Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    xdr::ToXdr,
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal, Val,
};
use utils::upgradeable::{UpgradeableInternal, UpgradeableStorage};

#[common_macros::lz_contract(upgradeable)]
pub struct UpgradeableLzContract;

impl UpgradeableInternal for UpgradeableLzContract {
    type MigrationData = Val;

    fn __migrate(env: &Env, _migration_data: &Self::MigrationData) {
        env.storage().instance().set(&soroban_sdk::Symbol::new(env, "migrated"), &true);
    }
}

#[contractimpl]
impl UpgradeableLzContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }
}

#[test]
fn migrate_is_guarded_and_wired() {
    let env = Env::default();
    let contract_id = env.register(UpgradeableLzContract, ());
    let client = UpgradeableLzContractClient::new(&env, &contract_id);

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
    let result = client
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
    assert_eq!(result.err().unwrap().ok().unwrap(), utils::errors::UpgradeableError::MigrationNotAllowed.into());

    // Set flag and migrate should succeed and clear the flag + run __migrate.
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
        let migrated: Option<bool> = env.storage().instance().get(&soroban_sdk::Symbol::new(&env, "migrated"));
        assert_eq!(migrated, Some(true));
    });
}

#[test]
fn still_exposes_ttl_features() {
    let env = Env::default();
    let contract_id = env.register(UpgradeableLzContract, ());
    let client = UpgradeableLzContractClient::new(&env, &contract_id);

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
