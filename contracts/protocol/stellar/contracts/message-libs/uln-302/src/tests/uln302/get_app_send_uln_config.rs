extern crate std;
use endpoint_v2::SetConfigParam;
use soroban_sdk::{log, testutils::Address as _, vec, xdr::ToXdr, Address, Env};

use crate::{
    interfaces::{OAppUlnConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    uln302::CONFIG_TYPE_SEND_ULN,
};

#[test]
fn test_get_oapp_send_uln_config() {
    let setup = setup();

    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config);

    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    let custom_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: true,
        uln_config: UlnConfig::generate(&env, 20, 1, 0, 0),
    };

    let config_bytes = custom_config.clone().to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Get raw oapp config
    let oapp_config = uln302.oapp_send_uln_config(&oapp, &eid).unwrap();
    assert_eq!(custom_config, oapp_config);
}

#[test]
fn test_get_oapp_send_uln_config_not_found() {
    let TestSetup { env, uln302, .. } = setup();

    let oapp = Address::generate(&env);
    log!(&env, "oapp: {}", oapp);

    let config = uln302.oapp_send_uln_config(&oapp, &100);
    assert_eq!(config, None);
}
