extern crate std;
use endpoint_v2::{MessageLibVersion, SetConfigParam};
use soroban_sdk::{testutils::Address as _, vec, xdr::ToXdr, Address};

use crate::{
    errors::Uln302Error,
    interfaces::{ExecutorConfig, OAppUlnConfig, UlnConfig},
    tests::setup::{setup, TestSetup},
    types::MAX_DVNS,
    uln302::{CONFIG_TYPE_RECEIVE_ULN, CONFIG_TYPE_SEND_ULN},
    Uln302Client,
};

// ==================== Test Unsupported EID ====================

#[test]
fn test_set_config_unsupported_eid_should_fail() {
    // Sui equivalent: test_set_config_unsupported_eid_should_fail
    // Don't set up any configs for EID 999 - this makes it unsupported
    let setup = setup();
    let TestSetup { env, uln302, endpoint, .. } = setup;

    let oapp = Address::generate(&env);
    let unsupported_eid = 999u32;

    // Create a valid OApp config
    let config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = config.to_xdr(&env);
    let params =
        vec![&env, SetConfigParam { eid: unsupported_eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];

    // This should fail with UnsupportedEid because EID 999 has no default configs
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::UnsupportedEid.into());
}

// ==================== Test Invalid Config Type ====================

#[test]
fn test_set_config_invalid_type_should_fail() {
    // Sui equivalent: test_set_config_invalid_type_should_fail
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 15, 2, 3, 2);
    let eid = 100;

    // Set up configs for the EID to make it supported
    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Create a valid OApp config
    let config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = config.to_xdr(&env);
    let invalid_config_type = 999u32; // Invalid config type (not 1, 2, or 3)
    let params = vec![&env, SetConfigParam { eid, config_type: invalid_config_type, config: config_bytes }];

    // This should fail with InvalidConfigType because config type 999 is invalid
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidConfigType.into());
}

// ==================== Test Invalid Confirmations ====================

#[test]
fn test_set_send_config_invalid_confirmations_use_default_but_nonzero() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: use_default_confirmations = true but confirmations != 0
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 99, // Should be 0 when using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidConfirmations.into());
}

#[test]
fn test_set_receive_config_invalid_confirmations_use_default_but_nonzero() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: use_default_confirmations = true but confirmations != 0
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 50, // Should be 0 when using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidConfirmations.into());
}

#[test]
fn test_set_send_config_valid_confirmations_use_default_with_zero() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: use_default_confirmations = true and confirmations == 0
    let valid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0, // Must be 0 when using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

#[test]
fn test_set_send_config_valid_confirmations_custom_with_any_value() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: use_default_confirmations = false, confirmations can be any value
    let valid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 25, // Can be any value when not using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

// ==================== Test Invalid Required DVNs ====================

#[test]
fn test_set_send_config_invalid_required_dvns_use_default_but_not_empty() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: use_default_required_dvns = true but required_dvns is not empty
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0,                                   // Must be 0 when using default
            required_dvns: vec![&env, Address::generate(&env)], // Should be empty when using default
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidRequiredDVNs.into());
}

#[test]
fn test_set_receive_config_invalid_required_dvns_use_default_but_not_empty() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: use_default_required_dvns = true but required_dvns is not empty
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0, // Must be 0 when using default
            required_dvns: vec![&env, Address::generate(&env), Address::generate(&env)], // Should be empty
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidRequiredDVNs.into());
}

#[test]
fn test_set_send_config_valid_required_dvns_use_default_with_empty() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: use_default_required_dvns = true and required_dvns is empty
    let valid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0,          // Must be 0 when using default
            required_dvns: vec![&env], // Empty when using default
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

#[test]
fn test_set_send_config_invalid_required_dvns_duplicates() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    let dvn1 = Address::generate(&env);

    // Invalid: duplicate required DVNs
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, dvn1.clone(), dvn1.clone()], // Duplicate
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::DuplicateRequiredDVNs.into());
}

#[test]
fn test_set_send_config_invalid_required_dvns_too_many() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Create too many DVNs (MAX_DVNS + 1)
    let mut required_dvns = vec![&env];
    for _ in 0..(MAX_DVNS + 1) {
        required_dvns.push_back(Address::generate(&env));
    }

    // Invalid: too many required DVNs
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns,
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidRequiredDVNCount.into());
}

#[test]
fn test_set_send_config_valid_required_dvns_custom() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: custom required DVNs without duplicates and within limit
    let valid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, Address::generate(&env), Address::generate(&env)],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

// ==================== Test Invalid Optional DVNs ====================

#[test]
fn test_set_send_config_invalid_optional_dvns_use_default_but_threshold_nonzero() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: use_default_optional_dvns = true but threshold != 0
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0, // Must be 0 when using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 1, // Should be 0 when using default
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNs.into());
}

#[test]
fn test_set_send_config_invalid_optional_dvns_use_default_but_dvns_not_empty() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: use_default_optional_dvns = true but optional_dvns is not empty
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0, // Must be 0 when using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env, Address::generate(&env)], // Should be empty when using default
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNs.into());
}

#[test]
fn test_set_receive_config_invalid_optional_dvns_use_default_but_threshold_nonzero() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: use_default_optional_dvns = true but threshold != 0
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0, // Must be 0 when using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 2, // Should be 0 when using default
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNs.into());
}

#[test]
fn test_set_send_config_valid_optional_dvns_use_default() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: use_default_optional_dvns = true with threshold = 0 and empty dvns
    let valid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0, // Must be 0 when using default
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

#[test]
fn test_set_send_config_invalid_optional_dvns_duplicates() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    let dvn1 = Address::generate(&env);

    // Invalid: duplicate optional DVNs
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, Address::generate(&env)],
            optional_dvns: vec![&env, dvn1.clone(), dvn1.clone()], // Duplicate
            optional_dvn_threshold: 1,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::DuplicateOptionalDVNs.into());
}

#[test]
fn test_set_send_config_invalid_optional_dvns_too_many() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Create too many DVNs (MAX_DVNS + 1)
    let mut optional_dvns = vec![&env];
    for _ in 0..(MAX_DVNS + 1) {
        optional_dvns.push_back(Address::generate(&env));
    }

    // Invalid: too many optional DVNs
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, Address::generate(&env)],
            optional_dvns,
            optional_dvn_threshold: 1,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNCount.into());
}

#[test]
fn test_set_send_config_invalid_optional_dvns_threshold_zero_with_dvns() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: threshold = 0 but optional_dvns is not empty
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, Address::generate(&env)],
            optional_dvns: vec![&env, Address::generate(&env)],
            optional_dvn_threshold: 0, // Should be > 0 if optional_dvns is not empty
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNThreshold.into());
}

#[test]
fn test_set_send_config_invalid_optional_dvns_threshold_greater_than_dvns() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Invalid: threshold > optional_dvns.len()
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, Address::generate(&env)],
            optional_dvns: vec![&env, Address::generate(&env), Address::generate(&env)],
            optional_dvn_threshold: 3, // Greater than 2 DVNs
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidOptionalDVNThreshold.into());
}

#[test]
fn test_set_send_config_valid_optional_dvns_custom() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: custom optional DVNs with valid threshold
    let valid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, Address::generate(&env)],
            optional_dvns: vec![&env, Address::generate(&env), Address::generate(&env), Address::generate(&env)],
            optional_dvn_threshold: 2,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

#[test]
fn test_set_send_config_valid_optional_dvns_custom_empty() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: threshold = 0 with empty optional_dvns
    let valid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 20,
            required_dvns: vec![&env, Address::generate(&env)],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

// ==================== Test Combined Scenarios ====================

#[test]
fn test_set_send_config_valid_all_custom() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: all custom values
    let valid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 50,
            required_dvns: vec![&env, Address::generate(&env), Address::generate(&env)],
            optional_dvns: vec![&env, Address::generate(&env)],
            optional_dvn_threshold: 1,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_send_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

#[test]
fn test_set_receive_config_valid_all_custom() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 15, 1, 2, 1);
    let eid = 101;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Valid: all custom values
    let valid_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 30,
            required_dvns: vec![&env, Address::generate(&env)],
            optional_dvns: vec![&env, Address::generate(&env), Address::generate(&env)],
            optional_dvn_threshold: 2,
        },
    };

    let config_bytes = valid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_RECEIVE_ULN, config: config_bytes }];
    endpoint.set_config(&Address::generate(&env), &oapp, &uln302.address, &params);

    // Should succeed
    let result = uln302.oapp_receive_uln_config(&oapp, &eid);
    assert!(result.is_some());
}

#[test]
fn test_set_send_config_invalid_multiple_errors_confirmations_first() {
    let setup = setup();
    let default_config = UlnConfig::generate(&setup.env, 10, 2, 3, 2);
    let eid = 100;

    setup.set_default_configs(eid, default_config.clone());

    let TestSetup { env, uln302, endpoint, .. } = setup;
    let oapp = Address::generate(&env);

    // Multiple errors: invalid confirmations and invalid required_dvns
    // Should fail on confirmations check first
    let invalid_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 99,                                  // Invalid - should be 0 when using default
            required_dvns: vec![&env, Address::generate(&env)], // Also invalid - should be empty when using default
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let config_bytes = invalid_config.to_xdr(&env);
    let params = vec![&env, SetConfigParam { eid, config_type: CONFIG_TYPE_SEND_ULN, config: config_bytes }];
    let result = endpoint.try_set_config(&Address::generate(&env), &oapp, &uln302.address, &params);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidConfirmations.into());
}

// ==================== Version Tests ====================

#[test]
fn test_version() {
    // Sui equivalent: test_uln302_initialization / test_version_and_utility
    // Tests that ULN-302 version returns (3, 0, 2)
    let TestSetup { env, uln302, .. } = setup();

    let uln302_client = Uln302Client::new(&env, &uln302.address);
    let version = uln302_client.version();

    assert_eq!(version.major, 3);
    assert_eq!(version.minor, 0);
    assert_eq!(version.endpoint_version, 2);
    assert_eq!(version, MessageLibVersion { major: 3, minor: 0, endpoint_version: 2 });
}

// ==================== Supported EID Tests ====================

#[test]
fn test_is_supported_eid_initially_false() {
    // Sui equivalent: test_version_and_utility (is_supported_eid before configs)
    // Tests that is_supported_eid returns false initially
    let TestSetup { env, uln302, .. } = setup();

    let uln302_client = Uln302Client::new(&env, &uln302.address);

    // No configs set - should not be supported
    let eid = 999u32;
    assert!(!uln302_client.is_supported_eid(&eid));
}

#[test]
fn test_is_supported_eid_true_after_configs() {
    // Sui equivalent: test_version_and_utility (is_supported_eid after configs)
    // Tests that is_supported_eid returns true after all default configs are set
    let setup = setup();
    let eid = 100u32;

    // Set all default configs (executor, send, and receive)
    let config = UlnConfig::generate(&setup.env, 15, 2, 3, 2);
    setup.set_default_configs(eid, config);

    let TestSetup { env, uln302, .. } = setup;
    let uln302_client = Uln302Client::new(&env, &uln302.address);

    // Now should be supported
    assert!(uln302_client.is_supported_eid(&eid));

    // Different EID should still not be supported
    assert!(!uln302_client.is_supported_eid(&999u32));
}

#[test]
fn test_supported_eid_combinations_only_send_config() {
    // Sui equivalent: test_supported_eid_combinations
    // Tests various combinations of config presence - only send config set
    let setup = setup();
    let eid = 100u32;

    // Only set send config
    let config = UlnConfig::generate(&setup.env, 15, 2, 3, 2);
    setup.set_default_send_uln_config(eid, config);

    let TestSetup { env, uln302, .. } = setup;
    let uln302_client = Uln302Client::new(&env, &uln302.address);

    // Should NOT be supported (missing receive config)
    assert!(!uln302_client.is_supported_eid(&eid));
}

#[test]
fn test_supported_eid_combinations_only_receive_config() {
    // Sui equivalent: test_supported_eid_combinations
    // Tests various combinations of config presence - only receive config set
    let setup = setup();
    let eid = 100u32;

    // Only set receive config
    let config = UlnConfig::generate(&setup.env, 15, 2, 3, 2);
    setup.set_default_receive_uln_config(eid, config);

    let TestSetup { env, uln302, .. } = setup;
    let uln302_client = Uln302Client::new(&env, &uln302.address);

    // Should NOT be supported (missing send config)
    assert!(!uln302_client.is_supported_eid(&eid));
}

#[test]
fn test_supported_eid_combinations_all_configs() {
    // Sui equivalent: test_supported_eid_combinations
    // Tests that EID is supported only when all configs (executor, send, receive) are set
    let setup = setup();
    let eid = 100u32;

    let config = UlnConfig::generate(&setup.env, 15, 2, 3, 2);

    // First set only send config
    setup.set_default_send_uln_config(eid, config.clone());

    // Still not supported (missing executor and receive)
    assert!(!setup.uln302.is_supported_eid(&eid));

    // Now set receive config too
    setup.set_default_receive_uln_config(eid, config);

    // Still not supported (missing executor)
    assert!(!setup.uln302.is_supported_eid(&eid));

    // Now set executor config
    let executor_config = ExecutorConfig::generate(&setup.env, 10000);
    setup.set_default_executor_config(eid, executor_config);

    // Now fully supported
    assert!(setup.uln302.is_supported_eid(&eid));
}

// ==================== Config Management Tests ====================

#[test]
fn test_config_management_comprehensive() {
    // Sui equivalent: test_config_management
    // Tests all config setters and getters in one focused test
    let setup = setup();
    let executor = setup.register_executable_address();

    let eid = 42u32;
    let executor_config = ExecutorConfig::new(50000, &executor);
    let uln_config = UlnConfig::generate(&setup.env, 15, 2, 3, 2);

    // Set default configs
    setup.set_default_executor_config(eid, executor_config.clone());
    setup.set_default_send_uln_config(eid, uln_config.clone());
    setup.set_default_receive_uln_config(eid, uln_config.clone());

    let TestSetup { uln302, .. } = setup;

    // Verify executor config
    let retrieved_executor = uln302.default_executor_config(&eid).unwrap();
    assert_eq!(retrieved_executor.max_message_size, 50000);
    assert_eq!(retrieved_executor.executor, executor);

    // Verify send ULN config
    let retrieved_send = uln302.default_send_uln_config(&eid).unwrap();
    assert_eq!(retrieved_send.confirmations, 15);

    // Verify receive ULN config
    let retrieved_receive = uln302.default_receive_uln_config(&eid).unwrap();
    assert_eq!(retrieved_receive.confirmations, 15);

    // Verify EID is now supported
    assert!(uln302.is_supported_eid(&eid));
}
