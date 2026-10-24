use common_macros::contract_impl;
use soroban_sdk::{contract, Env};

use crate::{errors::Uln302Error, interfaces::UlnConfig};

#[contract]
struct DummyConfig;

#[contract_impl]
impl DummyConfig {
    pub fn validate_default_config(env: &Env, config: UlnConfig) {
        config.validate_default_config(env);
    }

    pub fn validate_at_least_one_dvn(env: &Env, config: UlnConfig) {
        config.validate_at_least_one_dvn(env);
    }
}

fn setup<'a>() -> (Env, DummyConfigClient<'a>) {
    let env = Env::default();

    let config = env.register(DummyConfig, ());
    let config_client = DummyConfigClient::new(&env, &config);
    (env, config_client)
}

#[test]
fn test_validate_default_config() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 1, 3, 1);
    config_client.validate_default_config(&config);
}

#[test]
fn test_validate_default_config_has_required_duplicates() {
    let (env, config_client) = setup();
    let mut config = UlnConfig::generate(&env, 1, 1, 3, 1);
    config.required_dvns.push_back(config.required_dvns.get(0).unwrap().clone());
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::DuplicateRequiredDVNs.into());
}

#[test]
fn test_validate_default_config_has_invalid_required_dvn_count() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 128, 3, 1);
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidRequiredDVNCount.into());
}

#[test]
fn test_validate_default_config_has_optional_duplicates() {
    let (env, config_client) = setup();
    let mut config = UlnConfig::generate(&env, 1, 1, 3, 1);
    config.optional_dvns.push_back(config.optional_dvns.get(0).unwrap().clone());
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::DuplicateOptionalDVNs.into());
}

#[test]
fn test_validate_default_config_has_invalid_optional_dvn_count() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 1, 128, 1);
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNCount.into());
}

#[test]
fn test_validate_default_config_has_invalid_optional_dvn_threshold() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 1, 3, 0);
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNThreshold.into());
}

#[test]
fn test_validate_default_config_has_zero_threshold_with_optional_dvns() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 1, 3, 4);
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNThreshold.into());
}

#[test]
fn test_validate_default_config_zero_dvns() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 0, 0, 0);
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::UlnAtLeastOneDVN.into());
}

#[test]
fn test_assert_beyond_max_dvns() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 128, 0, 0);
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidRequiredDVNCount.into());
}

#[test]
fn test_assert_beyond_max_dvns_with_optional_dvns() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 0, 128, 1);
    let result = config_client.try_validate_default_config(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNCount.into());
}

#[test]
fn test_validate_at_least_one_dvn_with_optional_dvns() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 0, 1, 1);
    config_client.validate_at_least_one_dvn(&config);
}

#[test]
fn test_validate_at_least_one_dvn_with_optional_dvns_and_threshold_0() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 0, 1, 0);
    let result = config_client.try_validate_at_least_one_dvn(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::UlnAtLeastOneDVN.into());
}

#[test]
fn test_validate_at_least_one_dvn_with_required_dvns() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 1, 0, 0);
    config_client.validate_at_least_one_dvn(&config);
}

#[test]
fn test_validate_at_least_one_dvn_has_no_dvns() {
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 1, 0, 0, 0);
    let result = config_client.try_validate_at_least_one_dvn(&config);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::UlnAtLeastOneDVN.into());
}

// ==================== Boundary Tests ====================

#[test]
fn test_exactly_127_required_dvns_should_pass() {
    // Sui equivalent: test_exactly_127_required_dvns_should_pass
    // Test with exactly 127 required DVNs (boundary test - should pass)
    let (env, config_client) = setup();
    let config = UlnConfig::generate(&env, 64, 127, 0, 0);

    // This should NOT abort - exactly 127 is allowed
    config_client.validate_default_config(&config);
}

#[test]
fn test_exactly_127_optional_dvns_should_pass() {
    // Sui equivalent: test_exactly_127_optional_dvns_should_pass
    // Test with exactly 127 optional DVNs (boundary test - should pass)
    let (env, config_client) = setup();

    // One required DVN to satisfy "at least one DVN" requirement
    // 127 optional DVNs with threshold of 64 (less than or equal to optional DVN count)
    let config = UlnConfig::generate(&env, 64, 1, 127, 64);

    // This should NOT abort - exactly 127 is allowed
    config_client.validate_default_config(&config);
}
