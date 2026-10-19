use soroban_sdk::{testutils::Address as _, Address, BytesN};

use crate::{endpoint_v2::EndpointV2, tests::endpoint_setup::setup};

#[test]
fn test_inbound_payload_hash_not_set() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;

    // When no payload hash is set, should return None
    let payload_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(payload_hash, None);
}

#[test]
fn test_inbound_payload_hash_after_setting() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2;
    let sender = BytesN::from_array(env, &[1u8; 32]);
    let nonce = 1;
    let expected_hash = BytesN::from_array(env, &[0xabu8; 32]);

    // Set payload hash using inbound function
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, nonce, &expected_hash)
    });

    // Verify payload hash is retrieved correctly
    let payload_hash = endpoint_client.inbound_payload_hash(&receiver, &src_eid, &sender, &nonce);
    assert_eq!(payload_hash, Some(expected_hash));
}
