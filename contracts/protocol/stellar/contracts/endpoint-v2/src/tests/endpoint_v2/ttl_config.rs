use soroban_sdk::{testutils::Address as _, Address};
use utils::{
    errors::TtlConfigurableError,
    ttl_configurable::{TtlConfig, TtlConfigStorage},
};

use crate::tests::endpoint_setup::setup;
fn ttl_defaults(env: &soroban_sdk::Env, contract: &Address) -> (TtlConfig, TtlConfig) {
    env.as_contract(contract, || {
        (
            TtlConfigStorage::instance(env).expect("instance config should exist"),
            TtlConfigStorage::persistent(env).expect("persistent config should exist"),
        )
    })
}

#[test]
fn test_set_ttl_configs_success() {
    let context = setup();
    let env = &context.env;
    let endpoint = &context.endpoint_client;

    let max_ttl = env.as_contract(&context.endpoint_client.address, || env.storage().max_ttl());

    let instance_threshold = max_ttl / 4;
    let instance_extend_to = instance_threshold + 1;
    let persistent_threshold = max_ttl / 5;
    let persistent_extend_to = persistent_threshold + 2;

    let instance_config = Some(TtlConfig::new(instance_threshold, instance_extend_to));
    let persistent_config = Some(TtlConfig::new(persistent_threshold, persistent_extend_to));

    context.mock_owner_auth("set_ttl_configs", (&instance_config, &persistent_config));
    endpoint.set_ttl_configs(&instance_config, &persistent_config);

    let (stored_instance, stored_persistent) = ttl_defaults(env, &context.endpoint_client.address);

    assert_eq!(stored_instance, TtlConfig::new(instance_threshold, instance_extend_to));
    assert_eq!(stored_persistent, TtlConfig::new(persistent_threshold, persistent_extend_to));
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_ttl_configs_requires_owner() {
    let context = setup();
    let env = &context.env;
    let endpoint = &context.endpoint_client;
    let attacker = Address::generate(env);

    let instance_config = Some(TtlConfig::new(1, 2));
    let persistent_config = Some(TtlConfig::new(1, 2));

    context.mock_auth(&attacker, "set_ttl_configs", (&instance_config, &persistent_config));

    endpoint.set_ttl_configs(&instance_config, &persistent_config);
}

#[test]
fn test_panic_set_ttl_configs_invalid_instance_range() {
    let context = setup();
    let env = &context.env;
    let endpoint = &context.endpoint_client;

    let max_ttl = env.as_contract(&context.endpoint_client.address, || env.storage().max_ttl());
    let instance_threshold = max_ttl / 4 + 2;
    let instance_extend_to = instance_threshold - 1; // Invalid: extend_to < threshold

    let instance_config = Some(TtlConfig::new(instance_threshold, instance_extend_to));
    let persistent_config = Some(TtlConfig::new(1, 2));

    context.mock_owner_auth("set_ttl_configs", (&instance_config, &persistent_config));

    assert_eq!(
        endpoint.try_set_ttl_configs(&instance_config, &persistent_config).unwrap_err().unwrap(),
        TtlConfigurableError::InvalidTtlConfig.into()
    );
}

#[test]
fn test_panic_set_ttl_configs_exceeds_max_ttl() {
    let context = setup();
    let env = &context.env;
    let endpoint = &context.endpoint_client;

    let max_ttl = env.as_contract(&context.endpoint_client.address, || env.storage().max_ttl());
    let instance_extend_to = max_ttl.checked_add(1).expect("max_ttl is at u32::MAX");

    let instance_config = Some(TtlConfig::new(1, instance_extend_to)); // Invalid: extend_to > max_ttl
    let persistent_config = Some(TtlConfig::new(1, 2));

    context.mock_owner_auth("set_ttl_configs", (&instance_config, &persistent_config));

    assert_eq!(
        endpoint.try_set_ttl_configs(&instance_config, &persistent_config).unwrap_err().unwrap(),
        TtlConfigurableError::InvalidTtlConfig.into()
    );
}

// Frozen TTL Config Tests
#[test]
fn test_is_ttl_configs_frozen_default_false() {
    let context = setup();
    let endpoint = &context.endpoint_client;

    assert!(!endpoint.is_ttl_configs_frozen());
}

#[test]
fn test_freeze_ttl_configs_success() {
    let context = setup();
    let endpoint = &context.endpoint_client;

    assert!(!endpoint.is_ttl_configs_frozen());

    context.mock_owner_auth("freeze_ttl_configs", ());
    endpoint.freeze_ttl_configs();

    assert!(endpoint.is_ttl_configs_frozen());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_freeze_ttl_configs_requires_owner() {
    let context = setup();
    let env = &context.env;
    let endpoint = &context.endpoint_client;
    let attacker = Address::generate(env);

    context.mock_auth(&attacker, "freeze_ttl_configs", ());
    endpoint.freeze_ttl_configs();
}

#[test]
fn test_freeze_ttl_configs_already_frozen() {
    let context = setup();
    let endpoint = &context.endpoint_client;

    // First freeze
    context.mock_owner_auth("freeze_ttl_configs", ());
    endpoint.freeze_ttl_configs();

    // Try to freeze again
    context.mock_owner_auth("freeze_ttl_configs", ());
    assert_eq!(endpoint.try_freeze_ttl_configs().unwrap_err().unwrap(), TtlConfigurableError::TtlConfigAlreadyFrozen.into());
}

#[test]
fn test_set_ttl_configs_fails_when_frozen() {
    let context = setup();
    let endpoint = &context.endpoint_client;

    // Freeze first
    context.mock_owner_auth("freeze_ttl_configs", ());
    endpoint.freeze_ttl_configs();

    // Try to set TTL configs after freeze
    let instance_config = Some(TtlConfig::new(1, 2));
    let persistent_config = Some(TtlConfig::new(1, 2));

    context.mock_owner_auth("set_ttl_configs", (&instance_config, &persistent_config));
    assert_eq!(
        endpoint.try_set_ttl_configs(&instance_config, &persistent_config).unwrap_err().unwrap(),
        TtlConfigurableError::TtlConfigFrozen.into()
    );
}

#[test]
fn test_set_ttl_configs_then_freeze() {
    let context = setup();
    let env = &context.env;
    let endpoint = &context.endpoint_client;

    // Set custom TTL configs
    let instance_config = Some(TtlConfig::new(100, 200));
    let persistent_config = Some(TtlConfig::new(300, 400));

    context.mock_owner_auth("set_ttl_configs", (&instance_config, &persistent_config));
    endpoint.set_ttl_configs(&instance_config, &persistent_config);

    // Freeze
    context.mock_owner_auth("freeze_ttl_configs", ());
    endpoint.freeze_ttl_configs();

    // Verify configs are preserved after freeze
    let (stored_instance, stored_persistent) = ttl_defaults(env, &context.endpoint_client.address);
    assert_eq!(stored_instance, TtlConfig::new(100, 200));
    assert_eq!(stored_persistent, TtlConfig::new(300, 400));

    // Verify frozen
    assert!(endpoint.is_ttl_configs_frozen());

    // Verify cannot modify after freeze
    let new_instance_config = Some(TtlConfig::new(500, 600));
    context.mock_owner_auth("set_ttl_configs", (&new_instance_config, &persistent_config));
    assert_eq!(
        endpoint.try_set_ttl_configs(&new_instance_config, &persistent_config).unwrap_err().unwrap(),
        TtlConfigurableError::TtlConfigFrozen.into()
    );
}
