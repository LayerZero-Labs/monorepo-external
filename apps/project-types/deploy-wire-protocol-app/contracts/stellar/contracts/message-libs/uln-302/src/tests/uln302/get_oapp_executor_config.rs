extern crate std;
use endpoint_v2::SetConfigParam;
use soroban_sdk::{log, testutils::Address as _, vec, xdr::ToXdr, Address, Env};

use crate::{
    interfaces::{ExecutorConfig, OAppExecutorConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    uln302::CONFIG_TYPE_EXECUTOR,
};

#[test]
fn test_get_oapp_executor_config() {
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

    let custom_executor = setup.register_executable_address();
    let custom_config = OAppExecutorConfig { max_message_size: 3000, executor: Some(custom_executor.clone()) };

    let config_bytes = custom_config.to_xdr(&setup.env);
    let params = vec![&setup.env, SetConfigParam { eid, config_type: CONFIG_TYPE_EXECUTOR, config: config_bytes }];
    setup.endpoint.set_config(&Address::generate(&setup.env), &oapp, &setup.uln302.address, &params);

    let oapp_config = setup.uln302.oapp_executor_config(&oapp, &eid).unwrap();
    assert_eq!(oapp_config.max_message_size, 3000);
    assert_eq!(oapp_config.executor, Some(custom_executor));
}

#[test]
fn test_get_oapp_executor_config_not_found() {
    let TestSetup { env, uln302, .. } = setup();

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    let config = uln302.oapp_executor_config(&oapp, &102);
    assert_eq!(config, None);
}
