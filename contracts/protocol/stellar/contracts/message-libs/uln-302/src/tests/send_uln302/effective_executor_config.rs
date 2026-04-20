extern crate std;

use crate::{
    events::ExecutorConfigSet,
    interfaces::{ExecutorConfig, OAppExecutorConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    uln302::CONFIG_TYPE_EXECUTOR,
};
use endpoint_v2::SetConfigParam;
use soroban_sdk::{log, testutils::Address as _, vec, xdr::ToXdr, Address, Bytes, Env};
use utils::testing_utils::assert_eq_event;

#[test]
fn test_effective_executor_config_with_default_only() {
    let setup = setup();

    let executor = setup.register_executable_address();
    let default_config = ExecutorConfig { max_message_size: 5000, executor };
    let eid = 102;

    setup.set_default_executor_config(eid, default_config.clone());

    let TestSetup { env, uln302, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    let config = uln302.effective_executor_config(&oapp, &eid);
    assert_eq!(config, default_config);
}

#[test]
fn test_effective_executor_config_with_custom_executor() {
    let setup = setup();

    let eid = 102;
    let default_executor = setup.register_executable_address();
    let default_config = ExecutorConfig { max_message_size: 5000, executor: default_executor };

    let default_uln_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);

    setup.set_default_executor_config(eid, default_config.clone());

    setup.set_default_receive_uln_config(eid, default_uln_config.clone());
    setup.set_default_send_uln_config(eid, default_uln_config.clone());

    let oapp = Address::generate(&setup.env);
    log!(&setup.env, "oapp: {}", oapp);

    // Set custom executor but use default message size
    let custom_executor = setup.register_executable_address();
    let custom_config = OAppExecutorConfig { max_message_size: 0, executor: Some(custom_executor.clone()) };

    let config_bytes = custom_config.clone().to_xdr(&setup.env);
    let params = vec![&setup.env, SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: config_bytes }];
    setup.endpoint.set_config(&Address::generate(&setup.env), &oapp, &setup.uln302.address, &params);

    // Assert ExecutorConfigSet event was published immediately after the setter

    assert_eq_event(
        &setup.env,
        &setup.uln302.address,
        ExecutorConfigSet { config: Some(custom_config.clone()), dst_eid: eid, sender: oapp.clone() },
    );

    let config = setup.uln302.effective_executor_config(&oapp, &eid);
    assert_eq!(config.executor, custom_executor);
    assert_eq!(config.max_message_size, default_config.max_message_size);
}

#[test]
fn test_effective_executor_config_with_custom_message_size() {
    let setup = setup();

    let eid = 102;
    let default_executor = setup.register_executable_address();
    let default_config = ExecutorConfig { max_message_size: 5000, executor: default_executor.clone() };

    let default_uln_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);

    setup.set_default_executor_config(eid, default_config.clone());

    setup.set_default_receive_uln_config(eid, default_uln_config.clone());
    setup.set_default_send_uln_config(eid, default_uln_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    // Set custom message size but use default executor
    let custom_config = OAppExecutorConfig { max_message_size: 10000, executor: None };

    let config_bytes = custom_config.clone().to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    let config = uln302.effective_executor_config(&oapp, &eid);
    assert_eq!(config.executor, default_executor);
    assert_eq!(config.max_message_size, custom_config.max_message_size);
}

#[test]
fn test_effective_executor_config_fully_custom() {
    let setup = setup();

    let eid = 102;
    let default_executor = setup.register_executable_address();
    let default_config = ExecutorConfig { max_message_size: 5000, executor: default_executor.clone() };

    let default_uln_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);

    setup.set_default_executor_config(eid, default_config.clone());

    setup.set_default_receive_uln_config(eid, default_uln_config.clone());
    setup.set_default_send_uln_config(eid, default_uln_config.clone());

    let oapp = Address::generate(&setup.env);
    log!(&setup.env, "oapp: {}", oapp);

    // Set both custom executor and message size
    let custom_executor = setup.register_executable_address();
    let custom_config = OAppExecutorConfig { max_message_size: 8000, executor: Some(custom_executor.clone()) };

    let config_bytes = custom_config.clone().to_xdr(&setup.env);
    let params = vec![&setup.env, SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: config_bytes }];
    setup.endpoint.set_config(&Address::generate(&setup.env), &oapp, &setup.uln302.address, &params);

    let config = setup.uln302.effective_executor_config(&oapp, &eid);
    assert_eq!(config.executor, custom_executor);
    assert_eq!(config.max_message_size, custom_config.max_message_size);
}

#[test]
fn test_remove_executor_config_by_setting_none() {
    let setup = setup();

    let eid = 102;
    let default_executor = setup.register_executable_address();
    let default_config = ExecutorConfig { max_message_size: 5000, executor: default_executor.clone() };

    let default_uln_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);

    setup.set_default_executor_config(eid, default_config.clone());
    setup.set_default_receive_uln_config(eid, default_uln_config.clone());
    setup.set_default_send_uln_config(eid, default_uln_config.clone());

    let oapp = Address::generate(&setup.env);

    // Step 1: Set a custom executor config
    let custom_executor = setup.register_executable_address();
    let custom_config = OAppExecutorConfig { max_message_size: 8000, executor: Some(custom_executor.clone()) };

    let config_bytes = custom_config.clone().to_xdr(&setup.env);
    let params = vec![&setup.env, SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: config_bytes }];
    setup.endpoint.set_config(&Address::generate(&setup.env), &oapp, &setup.uln302.address, &params);

    // Verify custom config is applied
    let config = setup.uln302.effective_executor_config(&oapp, &eid);
    assert_eq!(config.executor, custom_executor);
    assert_eq!(config.max_message_size, 8000);
    assert!(setup.uln302.oapp_executor_config(&oapp, &eid).is_some());

    // Step 2: Remove the custom config by setting None
    let none_config: Option<OAppExecutorConfig> = None;
    let config_bytes = none_config.to_xdr(&setup.env);
    assert_eq!(config_bytes, Bytes::from_array(&setup.env, &[0, 0, 0, 1])); // ScVal::Void XDR encoding
    let params = vec![&setup.env, SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: config_bytes }];
    setup.endpoint.set_config(&Address::generate(&setup.env), &oapp, &setup.uln302.address, &params);

    // Verify the OApp-specific config is removed
    assert_eq!(setup.uln302.oapp_executor_config(&oapp, &eid), None);

    // Verify the effective config falls back to defaults
    let config = setup.uln302.effective_executor_config(&oapp, &eid);
    assert_eq!(config, default_config);
}
