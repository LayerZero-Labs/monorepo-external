use soroban_sdk::{testutils::Address as _, vec, Address, BytesN};

use crate::{endpoint_v2::EndpointV2, tests::endpoint_setup::setup};

#[test]
fn test_pending_inbound_nonces_initially_empty() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
}

#[test]
fn test_pending_inbound_nonces_sorted_and_no_duplicates() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    let hash_5 = BytesN::from_array(env, &[0x05u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 5u64, &hash_5)
    });
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), vec![env, 5u64]);

    let hash_2 = BytesN::from_array(env, &[0x02u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 2u64, &hash_2)
    });
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), vec![env, 2u64, 5u64]);

    let hash_4 = BytesN::from_array(env, &[0x04u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 4u64, &hash_4)
    });
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), vec![env, 2u64, 4u64, 5u64]);

    // Re-verify the same nonce should not duplicate it in the pending list.
    let hash_4b = BytesN::from_array(env, &[0x44u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 4u64, &hash_4b)
    });
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), vec![env, 2u64, 4u64, 5u64]);
}

#[test]
fn test_pending_inbound_nonces_drains_when_consecutive_sequence_completed() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver = Address::generate(env);
    let src_eid = 2u32;
    let sender = BytesN::from_array(env, &[1u8; 32]);

    let hash_2 = BytesN::from_array(env, &[0x02u8; 32]);
    let hash_3 = BytesN::from_array(env, &[0x03u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 2u64, &hash_2);
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 3u64, &hash_3);
    });

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 0);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender), vec![env, 2u64, 3u64]);

    // Inserting nonce 1 closes the gap, so pending drains and inbound nonce advances to 3.
    let hash_1 = BytesN::from_array(env, &[0x01u8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver, src_eid, &sender, 1u64, &hash_1)
    });

    assert_eq!(endpoint_client.inbound_nonce(&receiver, &src_eid, &sender), 3);
    assert!(endpoint_client.pending_inbound_nonces(&receiver, &src_eid, &sender).is_empty());
}

#[test]
fn test_pending_inbound_nonces_isolated_by_path() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let receiver_a = Address::generate(env);
    let receiver_b = Address::generate(env);
    let src_eid_a = 2u32;
    let src_eid_b = 3u32;
    let sender_a = BytesN::from_array(env, &[1u8; 32]);
    let sender_b = BytesN::from_array(env, &[2u8; 32]);

    let hash = BytesN::from_array(env, &[0xabu8; 32]);
    env.as_contract(&endpoint_client.address, || {
        EndpointV2::inbound_for_test(env, &receiver_a, src_eid_a, &sender_a, 2u64, &hash);
        EndpointV2::inbound_for_test(env, &receiver_b, src_eid_a, &sender_a, 2u64, &hash);
        EndpointV2::inbound_for_test(env, &receiver_a, src_eid_b, &sender_a, 2u64, &hash);
        EndpointV2::inbound_for_test(env, &receiver_a, src_eid_a, &sender_b, 2u64, &hash);
    });

    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver_a, &src_eid_a, &sender_a), vec![env, 2u64]);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver_b, &src_eid_a, &sender_a), vec![env, 2u64]);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver_a, &src_eid_b, &sender_a), vec![env, 2u64]);
    assert_eq!(endpoint_client.pending_inbound_nonces(&receiver_a, &src_eid_a, &sender_b), vec![env, 2u64]);
}

