use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, IntoVal,
};

use crate::{
    interfaces::ReceiveUln302Client,
    tests::setup::{setup, TestSetup},
};

use super::{create_test_packet_header, create_test_payload_hash, CONFIRMATIONS};

#[test]
fn test_verification_returns_stored_data() {
    let TestSetup { env, uln302, .. } = setup();
    let dvn = Address::generate(&env);
    let receiver = Address::generate(&env);

    let packet_header = create_test_packet_header(&env, &receiver);
    let payload_hash = create_test_payload_hash(&env);

    let receive_client = ReceiveUln302Client::new(&env, &uln302.address);

    // Mock DVN auth and verify
    env.mock_auths(&[MockAuth {
        address: &dvn,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn, &packet_header, &payload_hash, &CONFIRMATIONS).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn, &packet_header, &payload_hash, &CONFIRMATIONS);

    // Query the verification
    let header_hash = endpoint_v2::util::keccak256(&env, &packet_header);
    let confirmations = receive_client.confirmations(&dvn, &header_hash, &payload_hash);

    assert!(confirmations.is_some());
    assert_eq!(confirmations.unwrap(), CONFIRMATIONS);
}

#[test]
fn test_verification_returns_none_for_missing() {
    let TestSetup { env, uln302, .. } = setup();
    let dvn = Address::generate(&env);
    let receiver = Address::generate(&env);

    let packet_header = create_test_packet_header(&env, &receiver);
    let payload_hash = create_test_payload_hash(&env);

    let receive_client = ReceiveUln302Client::new(&env, &uln302.address);

    // Query verification without storing any
    let header_hash = endpoint_v2::util::keccak256(&env, &packet_header);
    let confirmations = receive_client.confirmations(&dvn, &header_hash, &payload_hash);
    assert!(confirmations.is_none());
}

#[test]
fn test_verification_after_multiple_dvns() {
    let TestSetup { env, uln302, .. } = setup();
    let dvn1 = Address::generate(&env);
    let dvn2 = Address::generate(&env);
    let dvn3 = Address::generate(&env);
    let receiver = Address::generate(&env);

    let packet_header = create_test_packet_header(&env, &receiver);
    let payload_hash = create_test_payload_hash(&env);

    let confirmations1 = 25u64;
    let confirmations2 = 30u64;
    let confirmations3 = 35u64;

    let receive_client = ReceiveUln302Client::new(&env, &uln302.address);

    // DVN1 verifies
    env.mock_auths(&[MockAuth {
        address: &dvn1,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn1, &packet_header, &payload_hash, &confirmations1).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn1, &packet_header, &payload_hash, &confirmations1);

    // DVN2 verifies
    env.mock_auths(&[MockAuth {
        address: &dvn2,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn2, &packet_header, &payload_hash, &confirmations2).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn2, &packet_header, &payload_hash, &confirmations2);

    // DVN3 verifies
    env.mock_auths(&[MockAuth {
        address: &dvn3,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn3, &packet_header, &payload_hash, &confirmations3).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn3, &packet_header, &payload_hash, &confirmations3);

    // Query each DVN's verification separately
    let header_hash = endpoint_v2::util::keccak256(&env, &packet_header);

    let received_confirmations1 = receive_client.confirmations(&dvn1, &header_hash, &payload_hash);
    assert!(received_confirmations1.is_some());
    assert_eq!(received_confirmations1.unwrap(), confirmations1);

    let received_confirmations2 = receive_client.confirmations(&dvn2, &header_hash, &payload_hash);
    assert!(received_confirmations2.is_some());
    assert_eq!(received_confirmations2.unwrap(), confirmations2);

    let received_confirmations3 = receive_client.confirmations(&dvn3, &header_hash, &payload_hash);
    assert!(received_confirmations3.is_some());
    assert_eq!(received_confirmations3.unwrap(), confirmations3);
}
