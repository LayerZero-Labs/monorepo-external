// Runtime tests: `#[upgradeable]` + `#[only_auth]` behavior and migration state wiring.
//
// We avoid exercising `env.deployer().update_current_contract_wasm(...)` directly by setting
// the migrating flag via storage; the purpose here is to verify macro-generated wiring:
// - `upgrade`/`migrate` are generated as contract entrypoints
// - both are guarded by `#[only_auth]`
// - `migrate` delegates to `utils::upgradeable::migrate::<Self>` with correct MigrationData

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::ToXdr,
    xdr::{ScErrorCode, ScErrorType},
    Address, Bytes, BytesN, Env, Error, IntoVal, Val,
};
use utils::errors::AuthError;
use utils::upgradeable::{UpgradeableInternal, UpgradeableStorage};

// A small, known-good contract WASM used for upgrade() testing.
// Sourced from the `upgrader` crate test fixtures.
const TEST_UPGRADE_WASM: &[u8] =
    include_bytes!("../../../../upgrader/src/tests/test_data/test_upgradeable_contract1.wasm");

#[contract]
#[common_macros::ownable]
#[common_macros::upgradeable]
pub struct TestContract;

impl UpgradeableInternal for TestContract {
    type MigrationData = u32;

    fn __migrate(env: &Env, _migration_data: &Self::MigrationData) {
        env.storage().instance().set(&soroban_sdk::Symbol::new(env, "migrated"), &true);
        env.storage().instance().set(&soroban_sdk::Symbol::new(env, "migration_data"), _migration_data);
    }
}

#[contractimpl]
impl TestContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }
}

#[test]
fn upgrade_is_guarded_by_only_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.init(&owner);

    // Unauthorized call should fail (guard triggers before any upgrade body work).
    let hash = BytesN::<32>::from_array(&env, &[7u8; 32]);
    let unauthorized = client.try_upgrade(&hash);
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Wrong-address auth should also fail (auth must be provided by the current owner).
    let wrong_auth = client
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "upgrade",
                args: (&hash,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_upgrade(&hash);
    assert_eq!(
        wrong_auth.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );
}

#[test]
fn upgrade_sets_migrating_flag_with_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Upload a real contract WASM so update_current_contract_wasm succeeds.
    let wasm_hash = env.deployer().upload_contract_wasm(Bytes::from_slice(&env, TEST_UPGRADE_WASM));

    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "upgrade",
                args: (&wasm_hash,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .upgrade(&wasm_hash);

    env.as_contract(&contract_id, || {
        assert_eq!(UpgradeableStorage::migrating(&env), true);
    });
}

#[test]
fn migrate_is_guarded_and_obeys_migrating_flag() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let attacker = Address::generate(&env);
    client.init(&owner);
    let data: u32 = 7;
    let migration_data = data.to_xdr(&env);

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

    // Even with migrating flag set, wrong-address auth should fail.
    env.as_contract(&contract_id, || {
        UpgradeableStorage::set_migrating(&env, &true);
    });
    let wrong_auth = client
        .mock_auths(&[MockAuth {
            address: &attacker,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate",
                args: (&migration_data,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_migrate(&migration_data);
    assert_eq!(
        wrong_auth.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Set migrating flag directly, then migrate should succeed and clear the flag + run __migrate.
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
        let stored: Option<u32> = env.storage().instance().get(&soroban_sdk::Symbol::new(&env, "migration_data"));
        assert_eq!(stored, Some(data));
    });
}

#[test]
fn upgrade_and_migrate_fail_before_owner_init() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Without owner initialization, authorizer lookup fails (AuthError::AuthorizerNotFound),
    // which should surface as a contract error (not Context/InvalidAction).
    let hash = BytesN::<32>::from_array(&env, &[7u8; 32]);
    assert_eq!(client.try_upgrade(&hash).unwrap_err().unwrap(), AuthError::AuthorizerNotFound.into());

    // Even if migrating is set, migrate() still fails before init because auth can't resolve authorizer.
    env.as_contract(&contract_id, || {
        UpgradeableStorage::set_migrating(&env, &true);
    });
    let migration_data = 1u32.to_xdr(&env);
    assert_eq!(client.try_migrate(&migration_data).unwrap_err().unwrap(), AuthError::AuthorizerNotFound.into());
}

#[test]
fn migrate_rejects_invalid_migration_data_and_does_not_clear_flag() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Allow migrate, then pass invalid bytes (not XDR for u32).
    env.as_contract(&contract_id, || {
        UpgradeableStorage::set_migrating(&env, &true);
    });

    // Provide auth and pass bytes that are valid XDR but *not* a u32 payload.
    // Using a stable Bytes object avoids mock-arg matching pitfalls.
    let bad_bytes = Val::VOID.to_xdr(&env);
    let res = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "migrate",
                args: (&bad_bytes,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_migrate(&bad_bytes);

    assert_eq!(res.err().unwrap().ok().unwrap(), utils::errors::UpgradeableError::InvalidMigrationData.into());

    // Since migration failed before reaching the "clear flag" line, migrating should still be true.
    env.as_contract(&contract_id, || {
        assert_eq!(UpgradeableStorage::migrating(&env), true);
    });
}
