// Runtime tests: `#[contract_impl]` injects default TTL config initialization into `__constructor`.
//
// This validates behavior end-to-end at runtime (not just snapshot tests):
// - Registering a contract that defines `__constructor` should initialize default TTL configs
//   via `utils::ttl_configurable::init_default_ttl_configs`.

use soroban_sdk::{contract, Env};
use utils::ttl_configurable::{TtlConfig, TtlConfigStorage, LEDGERS_PER_DAY};

#[contract]
pub struct CtorContract;

#[common_macros::contract_impl]
impl CtorContract {
    // Constructor signature uses &Env to exercise the `env` (not `&env`) injection path.
    pub fn __constructor(env: &Env) {
        let _ = env;
    }
}

#[test]
fn constructor_initializes_default_ttl_configs() {
    let env = Env::default();

    // Registering with `()` will invoke `__constructor`.
    let contract_id = env.register(CtorContract, ());

    let (instance_cfg, persistent_cfg) = env.as_contract(&contract_id, || {
        (TtlConfigStorage::instance(&env), TtlConfigStorage::persistent(&env))
    });

    let expected = TtlConfig::new(29 * LEDGERS_PER_DAY, 30 * LEDGERS_PER_DAY);
    assert_eq!(instance_cfg, Some(expected));
    assert_eq!(persistent_cfg, Some(expected));
}

#[contract]
pub struct CtorOwnedEnvContract;

#[common_macros::contract_impl]
impl CtorOwnedEnvContract {
    // Owned Env to exercise the `&env` injection path.
    pub fn __constructor(env: Env) {
        let _ = env;
    }
}

#[test]
fn constructor_with_owned_env_initializes_default_ttl_configs() {
    let env = Env::default();
    let contract_id = env.register(CtorOwnedEnvContract, ());

    let (instance_cfg, persistent_cfg) = env.as_contract(&contract_id, || {
        (TtlConfigStorage::instance(&env), TtlConfigStorage::persistent(&env))
    });

    let expected = TtlConfig::new(29 * LEDGERS_PER_DAY, 30 * LEDGERS_PER_DAY);
    assert_eq!(instance_cfg, Some(expected));
    assert_eq!(persistent_cfg, Some(expected));
}

