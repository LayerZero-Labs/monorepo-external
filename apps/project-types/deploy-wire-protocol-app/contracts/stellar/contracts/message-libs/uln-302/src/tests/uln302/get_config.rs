extern crate std;

use soroban_sdk::{testutils::Address as _, xdr::FromXdr, Address};

use crate::{
    errors::Uln302Error,
    interfaces::{ExecutorConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    uln302::{CONFIG_TYPE_EXECUTOR, CONFIG_TYPE_RECEIVE_ULN, CONFIG_TYPE_SEND_ULN},
};

#[test]
fn test_get_config_invalid_config_type_should_fail() {
    let setup = setup();
    let eid = 100u32;

    // Must set defaults so the EID is considered supported.
    setup.set_default_configs(eid, UlnConfig::generate(&setup.env, 10, 1, 0, 0));

    let TestSetup { env, uln302, .. } = setup;
    let oapp = Address::generate(&env);

    let invalid_config_type = 999u32;
    let res = uln302.try_get_config(&eid, &oapp, &invalid_config_type);
    assert_eq!(res.err().unwrap().ok().unwrap(), Uln302Error::InvalidConfigType.into());
}

#[test]
fn test_get_config_executor_returns_effective_executor_config_xdr() {
    let setup = setup();
    let eid = 100u32;
    setup.set_default_configs(eid, UlnConfig::generate(&setup.env, 10, 1, 0, 0));

    let TestSetup { env, uln302, .. } = setup;
    let oapp = Address::generate(&env);

    let xdr = uln302.get_config(&eid, &oapp, &CONFIG_TYPE_EXECUTOR);
    let decoded = ExecutorConfig::from_xdr(&env, &xdr).ok().unwrap();

    assert_eq!(decoded, uln302.effective_executor_config(&oapp, &eid));
}

#[test]
fn test_get_config_send_uln_returns_effective_send_uln_config_xdr() {
    let setup = setup();
    let eid = 100u32;
    setup.set_default_configs(eid, UlnConfig::generate(&setup.env, 10, 1, 0, 0));

    let TestSetup { env, uln302, .. } = setup;
    let oapp = Address::generate(&env);

    let xdr = uln302.get_config(&eid, &oapp, &CONFIG_TYPE_SEND_ULN);
    let decoded = UlnConfig::from_xdr(&env, &xdr).ok().unwrap();

    assert_eq!(decoded, uln302.effective_send_uln_config(&oapp, &eid));
}

#[test]
fn test_get_config_receive_uln_returns_effective_receive_uln_config_xdr() {
    let setup = setup();
    let eid = 100u32;
    setup.set_default_configs(eid, UlnConfig::generate(&setup.env, 10, 1, 0, 0));

    let TestSetup { env, uln302, .. } = setup;
    let oapp = Address::generate(&env);

    let xdr = uln302.get_config(&eid, &oapp, &CONFIG_TYPE_RECEIVE_ULN);
    let decoded = UlnConfig::from_xdr(&env, &xdr).ok().unwrap();

    assert_eq!(decoded, uln302.effective_receive_uln_config(&oapp, &eid));
}
