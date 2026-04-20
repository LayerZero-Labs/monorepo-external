extern crate std;

use crate::{
    errors::Uln302Error,
    events::SendUlnConfigSet,
    interfaces::{OAppUlnConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    uln302::CONFIG_TYPE_SEND_ULN,
};
use endpoint_v2::SetConfigParam;
use soroban_sdk::{log, testutils::Address as _, vec, xdr::ToXdr, Address, Env};
use utils::testing_utils::assert_eq_event;

#[test]
fn test_effective_send_uln_config_with_default_only() {
    // setup default send & receive uln config to enable `is_supported_eid`
    let setup = setup();

    // default send & receive uln config
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, .. } = setup;

    let oapp = Address::generate(&env);

    log!(&env, "oapp: {}", oapp);
    // get send uln config for oapp without custom config - should return default
    let config = uln302.effective_send_uln_config(&oapp, &eid);
    assert_eq!(config, default_config);
}

#[test]
fn test_effective_send_uln_config_with_custom_config() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    // Create custom config that overrides confirmations but uses default DVNs
    let custom_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    // Set custom config via set_config
    let config_bytes = custom_config.clone().to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Assert SendUlnConfigSet event was published immediately after the setter
    assert_eq_event(
        &env,
        &uln302.address,
        SendUlnConfigSet { config: Some(custom_config.clone()), dst_eid: eid, sender: oapp.clone() },
    );

    // Get aggregated config - should have custom confirmations but default DVNs
    let config = uln302.effective_send_uln_config(&oapp, &eid);
    assert_eq!(config.confirmations, 20);
    assert_eq!(config.required_dvns, default_config.required_dvns);
    assert_eq!(config.optional_dvns, default_config.optional_dvns);
    assert_eq!(config.optional_dvn_threshold, default_config.optional_dvn_threshold);
}

#[test]
fn test_effective_send_uln_config_must_have_at_least_one_dvn() {
    let setup = setup();

    // Create default with DVNs
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 0, 0);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    // Create custom config that uses NO default DVNs and provides NO custom DVNs
    let custom_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = custom_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::UlnAtLeastOneDVN.into());
}

#[test]
fn test_remove_send_uln_config_by_setting_none() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);

    // Step 1: Set a custom send ULN config
    let custom_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = custom_config.clone().to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Verify custom config is applied
    let config = uln302.effective_send_uln_config(&oapp, &eid);
    assert_eq!(config.confirmations, 20);
    assert!(uln302.oapp_send_uln_config(&oapp, &eid).is_some());

    // Step 2: Remove the custom config by setting None
    let none_config: Option<OAppUlnConfig> = None;
    let config_bytes = none_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Verify the OApp-specific config is removed
    assert_eq!(uln302.oapp_send_uln_config(&oapp, &eid), None);

    // Verify the effective config falls back to defaults
    let config = uln302.effective_send_uln_config(&oapp, &eid);
    assert_eq!(config, default_config);
}
