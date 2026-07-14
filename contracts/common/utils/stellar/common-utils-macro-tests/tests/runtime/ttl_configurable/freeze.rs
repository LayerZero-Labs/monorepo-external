// Runtime tests: TTL config freeze behavior.
//
// Tests covered:
// - `freeze_ttl_configs` requires owner authorization.
// - After freeze, `set_ttl_configs` fails even with auth.
// - Double freeze fails with TtlConfigAlreadyFrozen.

use common_macros::{ownable, ttl_configurable};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal,
};
use utils::testing_utils::assert_eq_event;
use utils::ttl_configurable::TtlConfigsFrozen;
use utils::{errors::TtlConfigurableError, ttl_configurable::TtlConfig};

#[contract]
#[ttl_configurable]
#[ownable]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    pub fn init(env: Env, owner: Address) {
        Self::init_owner(&env, &owner);
    }
}

#[test]
fn freeze_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Unauthorized freeze should fail
    assert_eq!(
        client.try_freeze_ttl_configs().unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Authorized freeze should succeed
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "freeze_ttl_configs",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .freeze_ttl_configs();

    assert_eq_event(&env, &contract_id, TtlConfigsFrozen {});

    assert!(client.is_ttl_configs_frozen());
}

#[test]
fn freeze_blocks_set() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Freeze the config
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "freeze_ttl_configs",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .freeze_ttl_configs();

    // After freeze, set should fail even with auth
    let instance = Some(TtlConfig::new(1, 2));
    let none = None::<TtlConfig>;

    let result = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_ttl_configs",
                args: (&instance, &none).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_ttl_configs(&instance, &none);

    assert_eq!(result.unwrap_err().unwrap(), TtlConfigurableError::TtlConfigFrozen.into());
}

#[test]
fn double_freeze_fails() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // First freeze should succeed
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "freeze_ttl_configs",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .freeze_ttl_configs();

    assert!(client.is_ttl_configs_frozen());

    // Second freeze should fail (TtlConfigAlreadyFrozen)
    let result = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "freeze_ttl_configs",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_freeze_ttl_configs();

    assert_eq!(result.unwrap_err().unwrap(), TtlConfigurableError::TtlConfigAlreadyFrozen.into());
}
