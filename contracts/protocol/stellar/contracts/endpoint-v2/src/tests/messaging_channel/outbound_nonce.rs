use soroban_sdk::{testutils::Address as _, Address, BytesN};

use crate::{storage, tests::endpoint_setup::setup};

#[test]
fn test_outbound_nonce_initial_value() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    // Initial outbound nonce should be 0
    let nonce = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver);
    assert_eq!(nonce, 0);
}

#[test]
fn test_outbound_nonce_after_setting() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    let expected_nonce = 42;

    // Set outbound nonce
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_outbound_nonce(env, &sender, dst_eid, &receiver, &expected_nonce)
    });

    // Verify outbound nonce is retrieved correctly
    let nonce = endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver);
    assert_eq!(nonce, expected_nonce);
}
