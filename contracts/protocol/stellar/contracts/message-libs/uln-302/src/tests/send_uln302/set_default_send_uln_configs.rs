extern crate std;
use soroban_sdk::{
    testutils::{MockAuth, MockAuthInvoke},
    vec, IntoVal,
};
use utils::testing_utils::assert_eq_event;

use crate::{
    errors::Uln302Error,
    events::DefaultSendUlnConfigsSet,
    interfaces::{SendUln302Client, SetDefaultUlnConfigParam, UlnConfig},
    tests::setup::{setup, TestSetup},
};

#[test]
fn test_set_default_send_uln_configs() {
    let TestSetup { env, uln302, owner, .. } = setup();

    let oapp_send_uln_configs = vec![
        &env,
        SetDefaultUlnConfigParam { eid: 100, config: UlnConfig::generate(&env, 1, 1, 3, 1) },
        SetDefaultUlnConfigParam { eid: 101, config: UlnConfig::generate(&env, 2, 1, 3, 1) },
    ];

    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "set_default_send_uln_configs",
            args: (&oapp_send_uln_configs,).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    uln302.set_default_send_uln_configs(&oapp_send_uln_configs);

    // Assert DefaultSendUlnConfigSet event was published with all params
    assert_eq_event(&env, &uln302.address, DefaultSendUlnConfigsSet { params: oapp_send_uln_configs.clone() });

    let uln302_send_client = SendUln302Client::new(&env, &uln302.address);
    for config in oapp_send_uln_configs.clone() {
        assert_eq!(uln302_send_client.default_send_uln_config(&config.eid), Some(config.config));
    }
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_set_default_send_uln_configs_authorization() {
    let TestSetup { env, uln302, .. } = setup();

    let oapp_send_uln_configs =
        vec![&env, SetDefaultUlnConfigParam { eid: 100, config: UlnConfig::generate(&env, 1, 1, 3, 1) }];

    uln302.set_default_send_uln_configs(&oapp_send_uln_configs);
}

#[test]
fn test_set_default_send_uln_configs_assert_default_config() {
    let TestSetup { env, uln302, .. } = setup();

    let mut config = UlnConfig::generate(&env, 1, 1, 3, 1);
    config.required_dvns.push_back(config.required_dvns.get(0).unwrap().clone());
    let oapp_send_uln_configs = vec![&env, SetDefaultUlnConfigParam { eid: 100, config }];

    env.mock_all_auths();
    let result = uln302.try_set_default_send_uln_configs(&oapp_send_uln_configs);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::DuplicateRequiredDVNs.into());
}

#[test]
fn test_default_send_uln_config_not_found() {
    // Sui equivalent: test_error_no_default_uln_config
    // Attempt to get ULN config without setting it first
    let TestSetup { env, uln302, .. } = setup();

    let uln302_send_client = SendUln302Client::new(&env, &uln302.address);

    // Try to get default config for an EID that hasn't been configured
    let config = uln302_send_client.default_send_uln_config(&999);
    assert_eq!(config, None);
}
