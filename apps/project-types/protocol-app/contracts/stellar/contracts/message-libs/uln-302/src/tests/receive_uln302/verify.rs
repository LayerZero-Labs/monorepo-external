use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    Address, IntoVal,
};
use utils::testing_utils::assert_eq_event;

use crate::{
    events::PayloadVerified,
    interfaces::ReceiveUln302Client,
    tests::setup::{setup, TestSetup},
};

use super::{create_test_packet_header, create_test_payload_hash, CONFIRMATIONS};

#[test]
fn test_verify_stores_verification_correctly() {
    let TestSetup { env, uln302, .. } = setup();
    let dvn = Address::generate(&env);
    let receiver = Address::generate(&env);

    let packet_header = create_test_packet_header(&env, &receiver);
    let payload_hash = create_test_payload_hash(&env);

    let receive_client = ReceiveUln302Client::new(&env, &uln302.address);

    // Mock DVN auth
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

    // Verify that verification was stored
    let header_hash = endpoint_v2::util::keccak256(&env, &packet_header);
    let confirmations = receive_client.confirmations(&dvn, &header_hash, &payload_hash);
    assert!(confirmations.is_some());
    assert_eq!(confirmations.unwrap(), CONFIRMATIONS);
}

#[test]
fn test_verify_multiple_dvns_same_payload() {
    let TestSetup { env, uln302, .. } = setup();
    let dvn1 = Address::generate(&env);
    let dvn2 = Address::generate(&env);
    let receiver = Address::generate(&env);

    let packet_header = create_test_packet_header(&env, &receiver);
    let payload_hash = create_test_payload_hash(&env);
    let confirmations1 = 25u64;
    let confirmations2 = 30u64;

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

    // DVN2 verifies with different confirmations
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

    // Verify both verifications were stored separately
    let header_hash = endpoint_v2::util::keccak256(&env, &packet_header);
    let received_confirmations1 = receive_client.confirmations(&dvn1, &header_hash, &payload_hash);
    let received_confirmations2 = receive_client.confirmations(&dvn2, &header_hash, &payload_hash);

    assert!(received_confirmations1.is_some());
    assert_eq!(received_confirmations1.unwrap(), confirmations1);

    assert!(received_confirmations2.is_some());
    assert_eq!(received_confirmations2.unwrap(), confirmations2);
}

#[test]
fn test_verify_same_dvn_can_overwrite_verification() {
    let TestSetup { env, uln302, .. } = setup();
    let dvn = Address::generate(&env);
    let receiver = Address::generate(&env);

    let packet_header = create_test_packet_header(&env, &receiver);
    let payload_hash = create_test_payload_hash(&env);
    let confirmations1 = 25u64;
    let confirmations2 = 35u64;

    let receive_client = ReceiveUln302Client::new(&env, &uln302.address);

    // DVN verifies first time
    env.mock_auths(&[MockAuth {
        address: &dvn,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn, &packet_header, &payload_hash, &confirmations1).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn, &packet_header, &payload_hash, &confirmations1);

    // Verify first confirmation was stored
    let header_hash = endpoint_v2::util::keccak256(&env, &packet_header);
    let received_confirmations = receive_client.confirmations(&dvn, &header_hash, &payload_hash);
    assert_eq!(received_confirmations.unwrap(), confirmations1);

    // DVN verifies second time with different confirmations
    env.mock_auths(&[MockAuth {
        address: &dvn,
        invoke: &MockAuthInvoke {
            contract: &uln302.address,
            fn_name: "verify",
            args: (&dvn, &packet_header, &payload_hash, &confirmations2).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    receive_client.verify(&dvn, &packet_header, &payload_hash, &confirmations2);

    // Verify second confirmation overwrote the first
    let received_confirmations = receive_client.confirmations(&dvn, &header_hash, &payload_hash);
    assert_eq!(received_confirmations.unwrap(), confirmations2);
}

#[test]
fn test_verify_emits_event() {
    let TestSetup { env, uln302, .. } = setup();
    let dvn = Address::generate(&env);
    let receiver = Address::generate(&env);

    let packet_header = create_test_packet_header(&env, &receiver);
    let payload_hash = create_test_payload_hash(&env);

    let receive_client = ReceiveUln302Client::new(&env, &uln302.address);

    // Mock DVN auth
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

    // Verify PayloadVerified event was emitted
    assert_eq_event(
        &env,
        &uln302.address,
        PayloadVerified { dvn, header: packet_header, proof_hash: payload_hash, confirmations: CONFIRMATIONS },
    );
}
