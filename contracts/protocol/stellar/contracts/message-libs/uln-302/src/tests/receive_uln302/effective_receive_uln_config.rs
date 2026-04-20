extern crate std;
use crate::{
    errors::Uln302Error,
    events::ReceiveUlnConfigSet,
    interfaces::{OAppUlnConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    uln302::CONFIG_TYPE_RECEIVE_ULN,
};
use endpoint_v2::SetConfigParam;
use soroban_sdk::{log, testutils::Address as _, vec, xdr::ToXdr, Address, Env};
use utils::testing_utils::assert_eq_event;

#[test]
fn test_effective_receive_uln_config_with_default_only() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_receive_uln_config(eid, default_config.clone());

    let TestSetup { env, uln302, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    let config = uln302.effective_receive_uln_config(&oapp, &eid);
    assert_eq!(config, default_config);
}

#[test]
fn test_effective_receive_uln_config_with_custom_config() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);

    // Custom config that uses default confirmations but custom DVNs
    let custom_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig::generate(&env, 0, 3, 1, 1),
    };

    let expected_required_dvns = custom_config.uln_config.required_dvns.clone();
    let expected_optional_dvns = custom_config.uln_config.optional_dvns.clone();

    let config_bytes = custom_config.clone().to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Assert ReceiveUlnConfigSet event was published immediately after the setter
    assert_eq_event(
        &env,
        &uln302.address,
        ReceiveUlnConfigSet { config: Some(custom_config.clone()), receiver: oapp.clone(), src_eid: eid },
    );

    let config = uln302.effective_receive_uln_config(&oapp, &eid);
    assert_eq!(config.confirmations, default_config.confirmations);
    assert_eq!(config.required_dvns, expected_required_dvns);
    assert_eq!(config.optional_dvns, expected_optional_dvns);
}

#[test]
fn test_effective_receive_uln_config_must_have_at_least_one_dvn() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 10, 1, 0, 0);
    let eid = 101;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

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
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::UlnAtLeastOneDVN.into());
}

#[test]
fn test_remove_receive_uln_config_by_setting_none() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);

    // Step 1: Set a custom receive ULN config
    let custom_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig::generate(&env, 0, 3, 1, 1),
    };

    let config_bytes = custom_config.clone().to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Verify custom config is applied
    assert!(uln302.oapp_receive_uln_config(&oapp, &eid).is_some());
    let config = uln302.effective_receive_uln_config(&oapp, &eid);
    assert_eq!(config.required_dvns, custom_config.uln_config.required_dvns);

    // Step 2: Remove the custom config by setting None
    let none_config: Option<OAppUlnConfig> = None;
    let config_bytes = none_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Verify the OApp-specific config is removed
    assert_eq!(uln302.oapp_receive_uln_config(&oapp, &eid), None);

    // Verify the effective config falls back to defaults
    let config = uln302.effective_receive_uln_config(&oapp, &eid);
    assert_eq!(config, default_config);
}
