use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, IntoVal,
};

use crate::{
    errors::Uln302Error,
    interfaces::{ReceiveUln302Client, UlnConfig},
    tests::setup::{setup, TestSetup, REMOTE_EID as SRC_EID},
};

use super::{create_test_packet_header, create_test_packet_header_with_eid, create_test_payload_hash, CONFIRMATIONS};

fn create_test_uln_config(env: &soroban_sdk::Env) -> UlnConfig {
    // Config with 2 required DVNs and 1 optional DVN with threshold 1
    UlnConfig::generate(env, CONFIRMATIONS, 2, 1, 1)
}

fn create_only_required_dvns_config(env: &soroban_sdk::Env) -> UlnConfig {
    // Config with 2 required DVNs and no optional DVNs
    UlnConfig::generate(env, CONFIRMATIONS, 2, 0, 0)
}

fn create_only_optional_dvns_config(env: &soroban_sdk::Env) -> UlnConfig {
    // Config with no required DVNs and 1 optional DVN with threshold 1
    UlnConfig::generate(env, CONFIRMATIONS, 0, 1, 1)
}

#[test]
fn test_verifiable_with_all_required_dvns() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with only required DVNs
    let mut config = create_only_required_dvns_config(env);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Initially not verifiable
    assert!(!receive_client.verifiable(&packet_header, &payload_hash));

    // DVN1 verifies
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Still not verifiable (need both required DVNs)
    assert!(!receive_client.verifiable(&packet_header, &payload_hash));

    // DVN2 verifies
    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Now verifiable
    assert!(receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_verifiable_with_optional_dvns_only() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with only optional DVNs
    let mut config = create_only_optional_dvns_config(env);
    config.optional_dvns = vec![env, dvn1.clone()];
    config.optional_dvn_threshold = 1;
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Initially not verifiable
    assert!(!receive_client.verifiable(&packet_header, &payload_hash));

    // DVN1 verifies (meets threshold of 1)
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Now verifiable
    assert!(receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_verifiable_with_mixed_dvns() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let dvn3 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with both required and optional DVNs
    let mut config = create_test_uln_config(env);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    config.optional_dvns = vec![env, dvn3.clone()];
    config.optional_dvn_threshold = 1;
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Verify all DVNs
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS);

    env.mock_auths(&[MockAuth {
        address: &dvn3,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn3, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn3, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Now verifiable with all DVNs verified
    assert!(receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_not_verifiable_missing_required_dvn() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 2 required DVNs
    let mut config = create_only_required_dvns_config(env);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    test_setup.set_default_receive_uln_config(SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Only DVN1 verifies (DVN2 missing)
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Not verifiable because DVN2 hasn't verified
    assert!(!receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_not_verifiable_optional_threshold_not_met() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let dvn3 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 3 optional DVNs and threshold of 2
    let mut config = create_only_optional_dvns_config(env);
    config.optional_dvns = vec![env, dvn1.clone(), dvn2.clone(), dvn3.clone()];
    config.optional_dvn_threshold = 2; // Need 2 out of 3
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Only 1 optional DVN verifies (need 2)
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Not verifiable because optional threshold not met
    assert!(!receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_not_verifiable_insufficient_confirmations() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 2 required DVNs
    let mut config = create_only_required_dvns_config(env);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    test_setup.set_default_receive_uln_config(SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // DVNs verify with insufficient confirmations
    let insufficient_confirmations = CONFIRMATIONS - 1;

    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &insufficient_confirmations).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &insufficient_confirmations);

    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &insufficient_confirmations).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &insufficient_confirmations);

    // Not verifiable because confirmations are insufficient
    assert!(!receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_verifiable_with_higher_confirmations() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 2 required DVNs
    let mut config = create_only_required_dvns_config(env);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    test_setup.set_default_receive_uln_config(SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // DVNs verify with more confirmations than required
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &(CONFIRMATIONS + 10)).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &(CONFIRMATIONS + 10));

    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &(CONFIRMATIONS + 5)).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &(CONFIRMATIONS + 5));

    // Verifiable because confirmations exceed requirement
    assert!(receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_verifiable_invalid_eid() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let receiver = Address::generate(env);

    // Set up config
    let config = create_only_required_dvns_config(env);
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let invalid_eid = 999u32;
    let packet_header = create_test_packet_header_with_eid(env, &receiver, invalid_eid);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    let result = receive_client.try_verifiable(&packet_header, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidEID.into());
}

#[test]
fn test_verifiable_optional_threshold_zero() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with required DVNs but optional threshold = 0
    let mut config = create_only_required_dvns_config(env);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    config.optional_dvn_threshold = 0;
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Verify all required DVNs
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Verifiable with all required DVNs and threshold = 0
    assert!(receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_verifiable_partial_optional_verification() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let dvn3 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 1 required DVN and 2 optional DVNs with threshold of 1
    let mut config = create_test_uln_config(env);
    config.required_dvns = vec![env, dvn1.clone()];
    config.optional_dvns = vec![env, dvn2.clone(), dvn3.clone()];
    config.optional_dvn_threshold = 1; // Only need 1 out of 2
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Verify required DVN
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Verify only one optional DVN (threshold = 1, so this is enough)
    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS);
    // DVN3 doesn't verify

    // Verifiable because threshold is met
    assert!(receive_client.verifiable(&packet_header, &payload_hash));
}

#[test]
fn test_not_verifiable_required_verified_but_optional_threshold_not_met() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let dvn3 = Address::generate(env);
    let dvn4 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 2 required DVNs and 2 optional DVNs with threshold of 2
    let mut config = create_test_uln_config(env);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    config.optional_dvns = vec![env, dvn3.clone(), dvn4.clone()];
    config.optional_dvn_threshold = 2; // Need both optional DVNs
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Verify all required DVNs
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &CONFIRMATIONS);

    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Verify only 1 optional DVN (need 2)
    env.mock_auths(&[MockAuth {
        address: &dvn3,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn3, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn3, &packet_header, &payload_hash, &CONFIRMATIONS);
    // DVN4 doesn't verify

    // Not verifiable because optional threshold (2) is not met (only 1 verified)
    assert!(!receive_client.verifiable(&packet_header, &payload_hash));
}
