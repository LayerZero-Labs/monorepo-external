// Runtime tests: `#[lz_contract(multisig, upgradeable)]` wrapper macro.
//
// This ensures upgradeability works under self-owning (multisig) authorization.

use soroban_sdk::{
    testutils::{storage::Instance as _, Ledger as _},
    xdr::ToXdr,
    xdr::{ScErrorCode, ScErrorType},
    Env, Error, Val,
};
use utils::upgradeable::{UpgradeableInternal, UpgradeableStorage};

#[common_macros::lz_contract(multisig, upgradeable)]
pub struct MultisigUpgradeableLzContract;

impl UpgradeableInternal for MultisigUpgradeableLzContract {
    type MigrationData = Val;

    fn __migrate(env: &Env, _migration_data: &Self::MigrationData) {
        env.storage().instance().set(&soroban_sdk::Symbol::new(env, "migrated"), &true);
    }
}

#[test]
fn self_auth_can_migrate_when_flag_set() {
    let env = Env::default();
    let contract_id = env.register(MultisigUpgradeableLzContract, ());
    let client = MultisigUpgradeableLzContractClient::new(&env, &contract_id);
    let migration_data = Val::VOID.to_xdr(&env);

    // MultiSig auth => authorizer should be the contract address, without any init.
    let expected = env.as_contract(&contract_id, || env.current_contract_address());
    assert_eq!(client.authorizer(), Some(expected));

    // Unauthorized migrate should fail.
    let unauthorized = client.try_migrate(&migration_data);
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Enable self-auth for subsequent calls.
    env.mock_all_auths();

    // With auth, migrate without flag should fail with UpgradeableError.
    let no_flag = client.try_migrate(&migration_data);
    assert_eq!(no_flag.err().unwrap().ok().unwrap(), utils::errors::UpgradeableError::MigrationNotAllowed.into());

    // Set migrating flag and migrate with self-auth should succeed.
    env.as_contract(&contract_id, || {
        UpgradeableStorage::set_migrating(&env, &true);
    });

    client.migrate(&migration_data);

    env.as_contract(&contract_id, || {
        assert_eq!(UpgradeableStorage::migrating(&env), false);
        let migrated: Option<bool> = env.storage().instance().get(&soroban_sdk::Symbol::new(&env, "migrated"));
        assert_eq!(migrated, Some(true));
    });

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
