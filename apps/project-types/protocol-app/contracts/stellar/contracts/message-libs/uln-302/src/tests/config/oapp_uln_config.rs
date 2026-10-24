extern crate std;
use soroban_sdk::{testutils::Address as _, vec, Address, Env};

use crate::interfaces::{OAppUlnConfig, UlnConfig};

fn setup_env() -> Env {
    Env::default()
}

// ==================== Test apply_default method ====================

#[test]
fn test_apply_default_all_defaults() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    // OApp config that uses all defaults
    let oapp_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 99,                                  // Should be ignored
            required_dvns: vec![&env, Address::generate(&env)], // Should be ignored
            optional_dvns: vec![&env, Address::generate(&env)], // Should be ignored
            optional_dvn_threshold: 99,                         // Should be ignored
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, default_config.confirmations);
    assert_eq!(result.required_dvns, default_config.required_dvns);
    assert_eq!(result.optional_dvns, default_config.optional_dvns);
    assert_eq!(result.optional_dvn_threshold, default_config.optional_dvn_threshold);
}

#[test]
fn test_apply_default_custom_confirmations_only() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: false, // Use custom
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 25,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, 25);
    assert_eq!(result.required_dvns, default_config.required_dvns);
    assert_eq!(result.optional_dvns, default_config.optional_dvns);
    assert_eq!(result.optional_dvn_threshold, default_config.optional_dvn_threshold);
}

#[test]
fn test_apply_default_custom_required_dvns_only() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    let custom_required_dvns = vec![&env, Address::generate(&env), Address::generate(&env), Address::generate(&env)];

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: false, // Use custom
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: custom_required_dvns.clone(),
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, default_config.confirmations);
    assert_eq!(result.required_dvns, custom_required_dvns);
    assert_eq!(result.optional_dvns, default_config.optional_dvns);
    assert_eq!(result.optional_dvn_threshold, default_config.optional_dvn_threshold);
}

#[test]
fn test_apply_default_custom_optional_dvns_only() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    let custom_optional_dvns = vec![&env, Address::generate(&env), Address::generate(&env)];
    let custom_threshold = 1;

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: true,
        use_default_optional_dvns: false, // Use custom
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: vec![&env],
            optional_dvns: custom_optional_dvns.clone(),
            optional_dvn_threshold: custom_threshold,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, default_config.confirmations);
    assert_eq!(result.required_dvns, default_config.required_dvns);
    assert_eq!(result.optional_dvns, custom_optional_dvns);
    assert_eq!(result.optional_dvn_threshold, custom_threshold);
}

#[test]
fn test_apply_default_all_custom() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    let custom_required_dvns = vec![&env, Address::generate(&env)];
    let custom_optional_dvns = vec![&env, Address::generate(&env), Address::generate(&env), Address::generate(&env)];
    let custom_threshold = 2;

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 50,
            required_dvns: custom_required_dvns.clone(),
            optional_dvns: custom_optional_dvns.clone(),
            optional_dvn_threshold: custom_threshold,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, 50);
    assert_eq!(result.required_dvns, custom_required_dvns);
    assert_eq!(result.optional_dvns, custom_optional_dvns);
    assert_eq!(result.optional_dvn_threshold, custom_threshold);
}

#[test]
fn test_apply_default_mix_1() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    let custom_required_dvns = vec![&env, Address::generate(&env), Address::generate(&env), Address::generate(&env)];
    let custom_optional_dvns = vec![&env];

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 30,
            required_dvns: custom_required_dvns.clone(),
            optional_dvns: custom_optional_dvns.clone(),
            optional_dvn_threshold: 0,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, 30);
    assert_eq!(result.required_dvns, custom_required_dvns);
    assert_eq!(result.optional_dvns, custom_optional_dvns);
    assert_eq!(result.optional_dvn_threshold, 0);
}

#[test]
fn test_apply_default_mix_2() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    let custom_optional_dvns = vec![&env, Address::generate(&env)];

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: vec![&env],
            optional_dvns: custom_optional_dvns.clone(),
            optional_dvn_threshold: 1,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, default_config.confirmations);
    assert_eq!(result.required_dvns.len(), 0);
    assert_eq!(result.optional_dvns, custom_optional_dvns);
    assert_eq!(result.optional_dvn_threshold, 1);
}

#[test]
fn test_apply_default_empty_custom_dvns() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 10, 2, 3, 2);

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: false,
        use_default_optional_dvns: false,
        uln_config: UlnConfig {
            confirmations: 15,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, 15);
    assert_eq!(result.required_dvns.len(), 0);
    assert_eq!(result.optional_dvns.len(), 0);
    assert_eq!(result.optional_dvn_threshold, 0);
}

#[test]
fn test_apply_default_zero_confirmations() {
    let env = setup_env();

    let default_config = UlnConfig::generate(&env, 100, 1, 0, 0);

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: false,
        use_default_required_dvns: true,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: vec![&env],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.confirmations, 0);
    assert_eq!(result.required_dvns, default_config.required_dvns);
}

#[test]
fn test_apply_default_preserves_dvn_addresses() {
    let env = setup_env();

    let default_dvn1 = Address::generate(&env);
    let default_dvn2 = Address::generate(&env);
    let custom_dvn1 = Address::generate(&env);
    let custom_dvn2 = Address::generate(&env);

    let default_config = UlnConfig {
        confirmations: 10,
        required_dvns: vec![&env, default_dvn1.clone(), default_dvn2.clone()],
        optional_dvns: vec![&env],
        optional_dvn_threshold: 0,
    };

    let oapp_config = OAppUlnConfig {
        use_default_confirmations: true,
        use_default_required_dvns: false,
        use_default_optional_dvns: true,
        uln_config: UlnConfig {
            confirmations: 0,
            required_dvns: vec![&env, custom_dvn1.clone(), custom_dvn2.clone()],
            optional_dvns: vec![&env],
            optional_dvn_threshold: 0,
        },
    };

    let result = oapp_config.apply_default_config(&default_config);

    assert_eq!(result.required_dvns.get(0).unwrap(), custom_dvn1);
    assert_eq!(result.required_dvns.get(1).unwrap(), custom_dvn2);
}
