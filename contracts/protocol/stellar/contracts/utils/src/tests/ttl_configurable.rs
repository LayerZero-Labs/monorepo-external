extern crate std;

use crate::{
    auth::Auth,
    errors::{AuthError, TtlConfigurableError},
    ownable::{Ownable, OwnableInitializer},
    testing_utils::assert_eq_event,
    tests::test_helper::mock_auth,
    ttl_configurable::{
        init_default_ttl_configs, TtlConfig, TtlConfigStorage, TtlConfigsFrozen, TtlConfigsSet, TtlConfigurable,
        LEDGERS_PER_DAY, MAX_TTL,
    },
};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env};

const DEFAULT_INSTANCE_TTL: TtlConfig = TtlConfig::new(5 * LEDGERS_PER_DAY, 10 * LEDGERS_PER_DAY);
const DEFAULT_PERSISTENT_TTL: TtlConfig = TtlConfig::new(5 * LEDGERS_PER_DAY, 10 * LEDGERS_PER_DAY);

// ============================================
// Test Contract for TTL functionality
// ============================================

#[contract]
pub struct TtlTestContract;

#[contractimpl]
impl TtlTestContract {
    /// Test-only initializer to set the contract owner (required by `TtlConfigurable`).
    ///
    /// NOTE: This is intentionally *not* protected by auth, since it's only used in unit tests.
    pub fn init_owner(env: &Env, owner: Address) {
        <Self as OwnableInitializer>::init_owner(env, &owner);
    }

    // TtlConfigStorage storage tests
    pub fn frozen(env: &Env) -> bool {
        TtlConfigStorage::frozen(env)
    }

    pub fn set_frozen(env: &Env, value: bool) {
        TtlConfigStorage::set_frozen(env, &value);
    }

    pub fn instance_ttl(env: &Env) -> TtlConfig {
        TtlConfigStorage::instance(env).unwrap_or(DEFAULT_INSTANCE_TTL)
    }

    pub fn set_instance_ttl(env: &Env, config: TtlConfig) {
        TtlConfigStorage::set_instance(env, &config);
    }

    pub fn has_instance_ttl(env: &Env) -> bool {
        TtlConfigStorage::has_instance(env)
    }

    pub fn remove_instance_ttl(env: &Env) {
        TtlConfigStorage::remove_instance(env);
    }

    pub fn remove_persistent_ttl(env: &Env) {
        TtlConfigStorage::remove_persistent(env);
    }

    pub fn persistent_ttl(env: &Env) -> TtlConfig {
        TtlConfigStorage::persistent(env).unwrap_or(DEFAULT_PERSISTENT_TTL)
    }

    pub fn set_persistent_ttl(env: &Env, config: TtlConfig) {
        TtlConfigStorage::set_persistent(env, &config);
    }

    pub fn has_persistent_ttl(env: &Env) -> bool {
        TtlConfigStorage::has_persistent(env)
    }

    // TtlConfigurable tests (via default trait implementation on this contract)
    pub fn configurable_set_ttl_configs(env: &Env, instance: Option<TtlConfig>, persistent: Option<TtlConfig>) {
        <Self as TtlConfigurable>::set_ttl_configs(env, &instance, &persistent);
    }

    pub fn configurable_ttl_configs(env: &Env) -> (Option<TtlConfig>, Option<TtlConfig>) {
        <Self as TtlConfigurable>::ttl_configs(env)
    }

    pub fn configurable_freeze_ttl_configs(env: &Env) {
        <Self as TtlConfigurable>::freeze_ttl_configs(env);
    }

    pub fn is_ttl_configs_frozen(env: &Env) -> bool {
        <Self as TtlConfigurable>::is_ttl_configs_frozen(env)
    }

    pub fn call_init_default_ttl_configs(env: &Env) {
        init_default_ttl_configs(env);
    }
}

// Enable the default `TtlConfigurable` implementation (which requires `Auth`) on the test contract.
//
// Note: use plain Rust `impl` (not `#[contractimpl(contracttrait)]`) to avoid generating
// duplicate Soroban contract entrypoints that would collide with this test contract's helpers.

/// Auth implementation for test contract - uses the stored owner as authorizer.
impl Auth for TtlTestContract {
    fn authorizer(env: &soroban_sdk::Env) -> Option<Address> {
        <Self as Ownable>::owner(env)
    }
}
impl Ownable for TtlTestContract {}
impl OwnableInitializer for TtlTestContract {}
impl TtlConfigurable for TtlTestContract {}

fn setup_contract() -> (Env, Address, Address, TtlTestContractClient<'static>) {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    client.init_owner(&owner);
    (env, contract_id, owner, client)
}

fn owner_set_ttl_configs(
    env: &Env,
    contract_id: &Address,
    owner: &Address,
    client: &TtlTestContractClient,
    instance: &Option<TtlConfig>,
    persistent: &Option<TtlConfig>,
) {
    mock_auth(env, contract_id, owner, "configurable_set_ttl_configs", (instance, persistent));
    client.configurable_set_ttl_configs(instance, persistent);
}

fn owner_freeze_ttl_configs(env: &Env, contract_id: &Address, owner: &Address, client: &TtlTestContractClient) {
    mock_auth(env, contract_id, owner, "configurable_freeze_ttl_configs", ());
    client.configurable_freeze_ttl_configs();
}

// ============================================
// TtlConfig Struct Tests
// ============================================

#[test]
fn test_ttl_config_new() {
    let config = TtlConfig::new(100, 200);
    assert_eq!(config.threshold, 100);
    assert_eq!(config.extend_to, 200);
}

#[test]
fn test_ttl_config_is_valid() {
    // Representative valid configs
    assert!(TtlConfig::new(100, 200).is_valid(300)); // threshold < extend_to < max
    assert!(TtlConfig::new(100, 100).is_valid(200)); // threshold == extend_to
    assert!(TtlConfig::new(0, 0).is_valid(0)); // zeroes allowed
    assert!(TtlConfig::new(MAX_TTL, MAX_TTL).is_valid(MAX_TTL)); // max boundary

    // Representative invalid configs (the two failure modes)
    assert!(!TtlConfig::new(200, 100).is_valid(300)); // threshold > extend_to
    assert!(!TtlConfig::new(100, 400).is_valid(300)); // extend_to > max
}
// ============================================
// TtlConfigStorage Storage Tests
// ============================================

#[test]
fn test_ttl_config_data_defaults() {
    let (_, _, _owner, client) = setup_contract();

    // Default frozen state should be false
    assert!(!client.frozen());

    // Default TTLs should be returned when not set
    assert_eq!(client.instance_ttl(), DEFAULT_INSTANCE_TTL);
    assert_eq!(client.persistent_ttl(), DEFAULT_PERSISTENT_TTL);

    // has_* should return false initially
    assert!(!client.has_instance_ttl());
    assert!(!client.has_persistent_ttl());
}

#[test]
fn test_ttl_config_data_set_get_remove() {
    let (_, _, _owner, client) = setup_contract();

    let instance_cfg = TtlConfig::new(1000, 2000);
    let persistent_cfg = TtlConfig::new(3000, 4000);

    // Set and verify instance
    client.set_instance_ttl(&instance_cfg);
    assert!(client.has_instance_ttl());
    assert_eq!(client.instance_ttl(), instance_cfg);

    // Set and verify persistent
    client.set_persistent_ttl(&persistent_cfg);
    assert!(client.has_persistent_ttl());
    assert_eq!(client.persistent_ttl(), persistent_cfg);

    // Remove and verify defaults return
    client.remove_instance_ttl();
    assert!(!client.has_instance_ttl());
    assert_eq!(client.instance_ttl(), DEFAULT_INSTANCE_TTL);

    // Remove persistent
    client.remove_persistent_ttl();
    assert!(!client.has_persistent_ttl());
    assert_eq!(client.persistent_ttl(), DEFAULT_PERSISTENT_TTL);
}

#[test]
fn test_ttl_config_data_frozen() {
    let (_, _, _owner, client) = setup_contract();

    assert!(!client.frozen());

    client.set_frozen(&true);
    assert!(client.frozen());

    client.set_frozen(&false);
    assert!(!client.frozen());
}

#[test]
fn test_ttl_config_data_independent_storage() {
    let (_, _, _owner, client) = setup_contract();

    let instance_cfg = TtlConfig::new(100, 200);
    let persistent_cfg = TtlConfig::new(300, 400);

    // Set each independently and verify others unchanged
    client.set_instance_ttl(&instance_cfg);
    assert_eq!(client.instance_ttl(), instance_cfg);
    assert_eq!(client.persistent_ttl(), DEFAULT_PERSISTENT_TTL);

    client.set_persistent_ttl(&persistent_cfg);
    assert_eq!(client.instance_ttl(), instance_cfg);
    assert_eq!(client.persistent_ttl(), persistent_cfg);
}

#[test]
fn test_ttl_config_data_remove_when_not_set() {
    let (_, _, _owner, client) = setup_contract();

    // Removing when not set should not panic
    client.remove_instance_ttl();
    client.remove_persistent_ttl();

    // Should still return defaults
    assert_eq!(client.instance_ttl(), DEFAULT_INSTANCE_TTL);
    assert_eq!(client.persistent_ttl(), DEFAULT_PERSISTENT_TTL);
}

#[test]
fn test_init_default_ttl_configs() {
    let (_, _, _owner, client) = setup_contract();

    // Initially no configs set
    assert!(!client.has_instance_ttl());
    assert!(!client.has_persistent_ttl());

    // Call init_default_ttl_configs
    client.call_init_default_ttl_configs();

    // Both should now be set to default values (29 days threshold, 30 days extend_to)
    let expected_config = TtlConfig::new(29 * LEDGERS_PER_DAY, 30 * LEDGERS_PER_DAY);
    assert!(client.has_instance_ttl());
    assert!(client.has_persistent_ttl());
    assert_eq!(client.instance_ttl(), expected_config);
    assert_eq!(client.persistent_ttl(), expected_config);
}

// ============================================
// DefaultTtlConfigurable Tests - Basic Operations
// ============================================

#[test]
fn test_default_ttl_configurable_initial_state() {
    let (_, _, _owner, client) = setup_contract();

    let (instance, persistent) = client.configurable_ttl_configs();
    assert!(instance.is_none());
    assert!(persistent.is_none());

    assert!(!client.is_ttl_configs_frozen());
}

#[test]
fn test_default_ttl_configurable_set_all() {
    let (env, contract_id, owner, client) = setup_contract();

    let instance_cfg = TtlConfig::new(1000, 2000);
    let persistent_cfg = TtlConfig::new(3000, 4000);

    let instance = Some(instance_cfg);
    let persistent = Some(persistent_cfg);
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);

    assert_eq_event(&env, &contract_id, TtlConfigsSet { instance, persistent });

    let (instance, persistent) = client.configurable_ttl_configs();
    assert_eq!(instance, Some(instance_cfg));
    assert_eq!(persistent, Some(persistent_cfg));
}

#[test]
fn test_default_ttl_configurable_set_partial() {
    let (env, contract_id, owner, client) = setup_contract();

    let instance_cfg = TtlConfig::new(1000, 2000);

    // Only set instance config
    let instance = Some(instance_cfg);
    let persistent = None;
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq_event(&env, &contract_id, TtlConfigsSet { instance, persistent });

    let (instance, persistent) = client.configurable_ttl_configs();
    assert_eq!(instance, Some(instance_cfg));
    assert!(persistent.is_none());
}

#[test]
fn test_default_ttl_configurable_set_and_remove() {
    let (env, contract_id, owner, client) = setup_contract();

    let instance_cfg = TtlConfig::new(1000, 2000);
    let persistent_cfg = TtlConfig::new(3000, 4000);

    // Set configs
    let instance = Some(instance_cfg);
    let persistent = Some(persistent_cfg);
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq!(client.configurable_ttl_configs(), (Some(instance_cfg), Some(persistent_cfg)));

    // Remove only instance by passing None, keep persistent
    let instance = None;
    let persistent = Some(persistent_cfg);
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq_event(&env, &contract_id, TtlConfigsSet { instance, persistent });
    assert_eq!(client.configurable_ttl_configs(), (None, Some(persistent_cfg)));

    // Remove both by passing None
    let instance = None;
    let persistent = None;
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq_event(&env, &contract_id, TtlConfigsSet { instance, persistent });
    assert_eq!(client.configurable_ttl_configs(), (None, None));
}

// ============================================
// DefaultTtlConfigurable Tests - Freeze Operations
// ============================================

#[test]
fn test_default_ttl_configurable_freeze() {
    let (env, contract_id, owner, client) = setup_contract();

    assert!(!client.is_ttl_configs_frozen());
    owner_freeze_ttl_configs(&env, &contract_id, &owner, &client);
    assert_eq_event(&env, &contract_id, TtlConfigsFrozen {});
    assert!(client.is_ttl_configs_frozen());
}

#[test]
fn test_default_ttl_configurable_freeze_preserves_configs() {
    let (env, contract_id, owner, client) = setup_contract();

    let instance_cfg = TtlConfig::new(1000, 2000);
    let persistent_cfg = TtlConfig::new(3000, 4000);
    let instance = Some(instance_cfg);
    let persistent = Some(persistent_cfg);
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq!(client.configurable_ttl_configs(), (Some(instance_cfg), Some(persistent_cfg)));

    owner_freeze_ttl_configs(&env, &contract_id, &owner, &client);
    assert!(client.is_ttl_configs_frozen());

    // Freezing should not alter existing config values.
    assert_eq!(client.configurable_ttl_configs(), (Some(instance_cfg), Some(persistent_cfg)));
}

#[test]
fn test_default_ttl_configurable_set_when_frozen() {
    let (env, contract_id, owner, client) = setup_contract();

    owner_freeze_ttl_configs(&env, &contract_id, &owner, &client);

    let instance_cfg = TtlConfig::new(1000, 2000);
    let instance = Some(instance_cfg);
    let persistent = None;
    mock_auth(&env, &contract_id, &owner, "configurable_set_ttl_configs", (&instance, &persistent));
    let res = client.try_configurable_set_ttl_configs(&instance, &persistent);
    assert_eq!(res.err().unwrap().ok().unwrap(), TtlConfigurableError::TtlConfigFrozen.into());
}

#[test]
fn test_default_ttl_configurable_freeze_when_already_frozen() {
    let (env, contract_id, owner, client) = setup_contract();

    owner_freeze_ttl_configs(&env, &contract_id, &owner, &client);
    assert_eq_event(&env, &contract_id, TtlConfigsFrozen {});

    mock_auth(&env, &contract_id, &owner, "configurable_freeze_ttl_configs", ());
    let res = client.try_configurable_freeze_ttl_configs();
    assert_eq!(res.err().unwrap().ok().unwrap(), TtlConfigurableError::TtlConfigAlreadyFrozen.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_default_ttl_configurable_freeze_requires_auth() {
    let (_env, _contract_id, _owner, client) = setup_contract();

    // No `mock_auths` provided -> owner.require_auth() must fail.
    client.configurable_freeze_ttl_configs();
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_default_ttl_configurable_freeze_wrong_signer_fails() {
    let (env, contract_id, _owner, client) = setup_contract();
    let attacker = Address::generate(&env);

    // Provide auth for the wrong address -> still must fail because stored owner is different.
    mock_auth(&env, &contract_id, &attacker, "configurable_freeze_ttl_configs", ());
    client.configurable_freeze_ttl_configs();
}

#[test]
fn test_default_ttl_configurable_freeze_when_owner_not_set() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);

    // Even with auth, `require_owner_auth` should fail because no owner is set in storage.
    mock_auth(&env, &contract_id, &owner, "configurable_freeze_ttl_configs", ());
    let res = client.try_configurable_freeze_ttl_configs();
    assert_eq!(res.err().unwrap().ok().unwrap(), AuthError::AuthorizerNotFound.into());
}

// ============================================
// DefaultTtlConfigurable Tests - Validation
// ============================================

#[test]
fn test_default_ttl_configurable_invalid_instance_config() {
    let (env, contract_id, owner, client) = setup_contract();
    // threshold > extend_to is invalid
    let invalid_cfg = TtlConfig::new(3000, 2000);
    let instance = Some(invalid_cfg);
    let persistent = None;
    mock_auth(&env, &contract_id, &owner, "configurable_set_ttl_configs", (&instance, &persistent));
    let res = client.try_configurable_set_ttl_configs(&instance, &persistent);
    assert_eq!(res.err().unwrap().ok().unwrap(), TtlConfigurableError::InvalidTtlConfig.into());
}

#[test]
fn test_default_ttl_configurable_invalid_persistent_config() {
    let (env, contract_id, owner, client) = setup_contract();
    let invalid_cfg = TtlConfig::new(5000, 4000);
    let instance = None;
    let persistent = Some(invalid_cfg);
    mock_auth(&env, &contract_id, &owner, "configurable_set_ttl_configs", (&instance, &persistent));
    let res = client.try_configurable_set_ttl_configs(&instance, &persistent);
    assert_eq!(res.err().unwrap().ok().unwrap(), TtlConfigurableError::InvalidTtlConfig.into());
}

#[test]
fn test_default_ttl_configurable_invalid_does_not_partially_update() {
    let (env, contract_id, owner, client) = setup_contract();

    // Seed with an initial valid state.
    let before_instance = TtlConfig::new(1000, 2000);
    let before_persistent = TtlConfig::new(3000, 4000);
    let instance = Some(before_instance);
    let persistent = Some(before_persistent);
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq!(client.configurable_ttl_configs(), (Some(before_instance), Some(before_persistent)));

    // Attempt to update with one invalid config and one different valid config.
    // This must fail and must not partially apply any changes.
    let invalid_instance = TtlConfig::new(3000, 2000); // threshold > extend_to
    let next_persistent = TtlConfig::new(3100, 4100);
    let instance = Some(invalid_instance);
    let persistent = Some(next_persistent);
    mock_auth(&env, &contract_id, &owner, "configurable_set_ttl_configs", (&instance, &persistent));
    assert_eq!(
        client.try_configurable_set_ttl_configs(&instance, &persistent).unwrap_err().unwrap(),
        TtlConfigurableError::InvalidTtlConfig.into()
    );

    // Ensure nothing changed.
    assert_eq!(client.configurable_ttl_configs(), (Some(before_instance), Some(before_persistent)));
}

// ============================================================================
// Missing branches: owner auth & max-ttl bound behaviors
// ============================================================================

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_default_ttl_configurable_set_requires_auth() {
    let (_env, _contract_id, _owner, client) = setup_contract();
    let instance = Some(TtlConfig::new(1000, 2000));
    let persistent = None;

    // No `mock_auths` provided -> owner.require_auth() must fail.
    client.configurable_set_ttl_configs(&instance, &persistent);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_default_ttl_configurable_set_wrong_signer_fails() {
    let (env, contract_id, _owner, client) = setup_contract();
    let attacker = Address::generate(&env);

    let instance = Some(TtlConfig::new(1000, 2000));
    let persistent = None;

    // Provide auth for the wrong address -> still must fail because stored owner is different.
    mock_auth(&env, &contract_id, &attacker, "configurable_set_ttl_configs", (&instance, &persistent));
    client.configurable_set_ttl_configs(&instance, &persistent);
}

#[test]
fn test_default_ttl_configurable_set_when_owner_not_set() {
    let env = Env::default();
    let contract_id = env.register(TtlTestContract, ());
    let client = TtlTestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let instance = Some(TtlConfig::new(1000, 2000));
    let persistent = None;

    // Even with auth, `require_owner_auth` should fail because no owner is set in storage.
    mock_auth(&env, &contract_id, &owner, "configurable_set_ttl_configs", (&instance, &persistent));
    let res = client.try_configurable_set_ttl_configs(&instance, &persistent);
    assert_eq!(res.err().unwrap().ok().unwrap(), AuthError::AuthorizerNotFound.into());
}

#[test]
fn test_default_ttl_configurable_exceeds_effective_max_ttl() {
    let (env, contract_id, owner, client) = setup_contract();

    let effective_max = u32::min(MAX_TTL, env.storage().max_ttl());
    let invalid_extend_to = effective_max.checked_add(1).expect("effective_max at u32::MAX");
    let instance = Some(TtlConfig::new(1, invalid_extend_to));
    let persistent = None;

    mock_auth(&env, &contract_id, &owner, "configurable_set_ttl_configs", (&instance, &persistent));
    let res = client.try_configurable_set_ttl_configs(&instance, &persistent);
    assert_eq!(res.err().unwrap().ok().unwrap(), TtlConfigurableError::InvalidTtlConfig.into());
}

// ============================================
// DefaultTtlConfigurable Tests - Boundary Values
// ============================================

#[test]
fn test_default_ttl_configurable_boundary_values() {
    let (env, contract_id, owner, client) = setup_contract();

    let effective_max = u32::min(MAX_TTL, env.storage().max_ttl());

    // Zero threshold and extend_to
    let cfg = TtlConfig::new(0, 0);
    let instance = Some(cfg);
    let persistent = None;
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq!(client.configurable_ttl_configs().0, Some(cfg));

    // Zero threshold, max extend_to
    let cfg = TtlConfig::new(0, effective_max);
    let instance = Some(cfg);
    let persistent = None;
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq!(client.configurable_ttl_configs().0, Some(cfg));

    // Equal threshold and extend_to
    let cfg = TtlConfig::new(1000, 1000);
    let instance = Some(cfg);
    let persistent = None;
    owner_set_ttl_configs(&env, &contract_id, &owner, &client, &instance, &persistent);
    assert_eq!(client.configurable_ttl_configs().0, Some(cfg));
}
