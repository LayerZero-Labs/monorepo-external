// Runtime tests: TTL configuration read/write behavior.
//
// Tests covered:
// - `ttl_configs()` and `is_ttl_configs_frozen()` callable without auth.
// - `set_ttl_configs` requires owner authorization.
// - Invalid TTL config (threshold > extend_to) is rejected.

use common_macros::{ownable, ttl_configurable};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal,
};
use utils::testing_utils::assert_eq_event;
use utils::ttl_configurable::TtlConfigsSet;
use utils::{errors::{AuthError, TtlConfigurableError}, ttl_configurable::TtlConfig};

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
fn read_without_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Read methods should be callable without initialization/auth
    assert_eq!(client.ttl_configs(), (None, None));
    assert!(!client.is_ttl_configs_frozen());

    // Also works after owner initialization
    let owner = Address::generate(&env);
    client.init(&owner);

    assert_eq!(client.ttl_configs(), (None, None));
    assert!(!client.is_ttl_configs_frozen());
}

#[test]
fn set_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let before = client.ttl_configs();

    let instance = Some(TtlConfig::new(1, 2));
    let persistent = None::<TtlConfig>;

    // Unauthorized set should fail
    let unauthorized = client.try_set_ttl_configs(&instance, &persistent);
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Authorized set should succeed
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_ttl_configs",
                args: (&instance, &persistent).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_ttl_configs(&instance, &persistent);

    assert_eq_event(&env, &contract_id, TtlConfigsSet { instance, persistent });

    // Config should be updated
    let after = client.ttl_configs();
    assert_ne!(before, after);
    assert_eq!(after, (instance, persistent));
}

#[test]
fn set_before_init_fails_with_owner_not_set() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // No init() call => Ownable owner not set, so Auth::authorizer() fails.
    let instance = Some(TtlConfig::new(1, 2));
    let persistent = None::<TtlConfig>;
    let err = client.try_set_ttl_configs(&instance, &persistent).unwrap_err().unwrap();
    assert_eq!(err, AuthError::AuthorizerNotFound.into());
}

#[test]
fn set_and_remove_configs_roundtrip() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Set both configs.
    let instance = Some(TtlConfig::new(1, 2));
    let persistent = Some(TtlConfig::new(3, 4));
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_ttl_configs",
                args: (&instance, &persistent).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_ttl_configs(&instance, &persistent);

    assert_eq_event(&env, &contract_id, TtlConfigsSet { instance, persistent });
    assert_eq!(client.ttl_configs(), (instance, persistent));

    // Remove (disable) both configs.
    let none: Option<TtlConfig> = None::<TtlConfig>;
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_ttl_configs",
                args: (&none, &none).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .set_ttl_configs(&none, &none);

    assert_eq_event(&env, &contract_id, TtlConfigsSet { instance: none, persistent: none });
    assert_eq!(client.ttl_configs(), (None, None));
}

#[test]
fn invalid_config_rejected() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let before = client.ttl_configs();

    // Invalid config: threshold > extend_to
    let invalid_instance = Some(TtlConfig::new(100, 50)); // threshold=100 > extend_to=50
    let none: Option<TtlConfig> = None::<TtlConfig>;

    let result = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_ttl_configs",
                args: (&invalid_instance, &none).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_ttl_configs(&invalid_instance, &none);

    assert_eq!(result.unwrap_err().unwrap(), TtlConfigurableError::InvalidTtlConfig.into());
    // Config should remain unchanged on validation failure.
    assert_eq!(client.ttl_configs(), before);
}

#[test]
fn invalid_max_ttl_rejected() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let invalid = Some(TtlConfig::new(1, u32::MAX));
    let none: Option<TtlConfig> = None::<TtlConfig>;

    let result = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "set_ttl_configs",
                args: (&invalid, &none).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_set_ttl_configs(&invalid, &none);

    assert_eq!(result.unwrap_err().unwrap(), TtlConfigurableError::InvalidTtlConfig.into());
}
