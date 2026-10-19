use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN};

use crate::{endpoint_v2::EndpointV2, tests::endpoint_setup::setup, util::compute_guid};

#[test]
fn test_build_outbound_packet_basic() {
    let context = setup();
    let env = &context.env;
    let endpoint_addr = &context.endpoint_client.address;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    let message = Bytes::from_array(env, &[1, 2, 3, 4]);
    let nonce = 1u64;

    let packet = env.as_contract(endpoint_addr, || {
        EndpointV2::build_outbound_packet_for_test(env, &sender, dst_eid, &receiver, &message, nonce)
    });

    // Verify packet fields
    assert_eq!(packet.nonce, nonce);
    assert_eq!(packet.src_eid, context.eid);
    assert_eq!(packet.sender, sender);
    assert_eq!(packet.dst_eid, dst_eid);
    assert_eq!(packet.receiver, receiver);
    assert_eq!(packet.message, message);
    assert_eq!(packet.guid.len(), 32);

    // Verify GUID is computed correctly
    let expected_guid = compute_guid(env, nonce, context.eid, &sender, dst_eid, &receiver);
    assert_eq!(packet.guid, expected_guid);
}

#[test]
fn test_build_outbound_packet_empty_message() {
    let context = setup();
    let env = &context.env;
    let endpoint_addr = &context.endpoint_client.address;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    let message = Bytes::new(env);
    let nonce = 1u64;

    let packet = env.as_contract(endpoint_addr, || {
        EndpointV2::build_outbound_packet_for_test(env, &sender, dst_eid, &receiver, &message, nonce)
    });

    // Should handle empty message correctly
    assert_eq!(packet.message.len(), 0);
    assert_eq!(packet.nonce, nonce);
    assert_eq!(packet.guid.len(), 32);
}

#[test]
fn test_build_outbound_packet_large_message() {
    let context = setup();
    let env = &context.env;
    let endpoint_addr = &context.endpoint_client.address;

    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    let large_message = Bytes::from_array(env, &[0u8; 1000]);
    let nonce = 1u64;

    let packet = env.as_contract(endpoint_addr, || {
        EndpointV2::build_outbound_packet_for_test(env, &sender, dst_eid, &receiver, &large_message, nonce)
    });

    // Should handle large message correctly
    assert_eq!(packet.message.len(), 1000);
    assert_eq!(packet.message, large_message);
}
