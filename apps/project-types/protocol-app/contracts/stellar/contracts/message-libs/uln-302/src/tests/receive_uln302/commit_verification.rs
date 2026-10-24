use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, IntoVal,
};

use crate::{
    errors::Uln302Error,
    interfaces::{ReceiveUln302Client, UlnConfig},
    tests::setup::{setup, TestSetup},
};

use super::{
    create_test_packet_header, create_test_packet_header_with_eid, create_test_payload_hash, CONFIRMATIONS,
    REMOTE_EID as SRC_EID,
};

#[test]
fn test_commit_clears_verification_storage() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let dvn3 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 2 required DVNs and 1 optional DVN
    let mut config = UlnConfig::generate(env, CONFIRMATIONS, 2, 1, 1);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    config.optional_dvns = vec![env, dvn3.clone()];
    config.optional_dvn_threshold = 1;
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // All DVNs verify
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

    // Verify that verifications exist before commit
    let header_hash = endpoint_v2::util::keccak256(env, &packet_header);
    // Commit verification
    receive_client.commit_verification(&packet_header, &payload_hash);

    // Verify that all verifications were cleared
    assert!(receive_client.confirmations(&dvn1, &header_hash, &payload_hash).is_none());
    assert!(receive_client.confirmations(&dvn2, &header_hash, &payload_hash).is_none());
    assert!(receive_client.confirmations(&dvn3, &header_hash, &payload_hash).is_none());
}

#[test]
fn test_commit_second_time_fails() {
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 2 required DVNs
    let mut config = UlnConfig::generate(env, CONFIRMATIONS, 2, 0, 0);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    let packet_header = create_test_packet_header(env, &receiver);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Both required DVNs verify
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

    // First commit should succeed
    receive_client.commit_verification(&packet_header, &payload_hash);

    // Second commit should fail because storage was cleared (Verifying error)
    let result = receive_client.try_commit_verification(&packet_header, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::Verifying.into());
}

#[test]
fn test_commit_verification_invalid_eid_should_fail() {
    // Sui equivalent: test_commit_verification_invalid_eid_should_fail
    // Tests that commit_verification fails when packet dst_eid doesn't match endpoint EID
    let test_setup = setup();
    let TestSetup { env, uln302, .. } = &test_setup;

    let dvn1 = Address::generate(env);
    let dvn2 = Address::generate(env);
    let receiver = Address::generate(env);

    // Set up config with 2 required DVNs
    let mut config = UlnConfig::generate(env, CONFIRMATIONS, 2, 0, 0);
    config.required_dvns = vec![env, dvn1.clone(), dvn2.clone()];
    TestSetup::set_default_receive_uln_config(&test_setup, SRC_EID, config);

    // Create packet with WRONG dst_eid (different from endpoint EID)
    let invalid_dst_eid = 999u32;
    let packet_header = create_test_packet_header_with_eid(env, &receiver, invalid_dst_eid);
    let payload_hash = create_test_payload_hash(env);

    let receive_client = ReceiveUln302Client::new(env, &uln302.address);

    // Pre-verify the packet with DVNs (to get past the verification step)
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

    // This should fail with InvalidEID because packet.dst_eid (999) != endpoint.eid()
    let result = receive_client.try_commit_verification(&packet_header, &payload_hash);
    assert_eq!(result.err().unwrap().ok().unwrap(), Uln302Error::InvalidEID.into());
}
