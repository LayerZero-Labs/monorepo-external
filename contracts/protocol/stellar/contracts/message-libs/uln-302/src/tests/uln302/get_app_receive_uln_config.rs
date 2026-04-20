extern crate std;
use endpoint_v2::SetConfigParam;
use soroban_sdk::{log, testutils::Address as _, vec, xdr::ToXdr, Address, Env};

use crate::{
    interfaces::{OAppUlnConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    uln302::CONFIG_TYPE_RECEIVE_ULN,
};

#[test]
fn test_get_oapp_receive_uln_config() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_configs(eid, default_config);

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    let custom_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig::generate(&env, 0, 2, 1, 1),
    };

    let config_bytes = custom_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    let oapp_config = uln302.oapp_receive_uln_config(&oapp, &eid).unwrap();
    assert_eq!(oapp_config.use_default_confirmations, true);
    assert_eq!(oapp_config.use_default_required_dvns, false);
}

#[test]
fn test_get_oapp_receive_uln_config_not_found() {
    let TestSetup { env, uln302, .. } = setup();

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    let config = uln302.oapp_receive_uln_config(&oapp, &101);
    assert_eq!(config, None);
}
