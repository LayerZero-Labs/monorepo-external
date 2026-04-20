use soroban_sdk::{testutils::Address as _, Address, BytesN};

use crate::{storage, tests::endpoint_setup::setup, tests::endpoint_setup::TestSetup, util};

// Helpers
fn set_outbound_nonce(context: &TestSetup, sender: &Address, dst_eid: u32, receiver: &BytesN<32>, nonce: u64) {
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    env.as_contract(&endpoint_client.address, || {
        storage::EndpointStorage::set_outbound_nonce(env, sender, dst_eid, receiver, &nonce)
    });
}

fn expected_guid(context: &TestSetup, nonce: u64, sender: &Address, dst_eid: u32, receiver: &BytesN<32>) -> BytesN<32> {
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;
    env.as_contract(&endpoint_client.address, || util::compute_guid(env, nonce, context.eid, sender, dst_eid, receiver))
}

// The next_guid uses (outbound_nonce + 1) and does not mutate state
#[test]
fn test_next_guid_basic() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    // Initially outbound nonce should be 0, so next_guid should use nonce 1.
    assert_eq!(endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver), 0);

    let guid = endpoint_client.next_guid(&sender, &dst_eid, &receiver);
    assert_eq!(guid, expected_guid(&context, 1, &sender, dst_eid, &receiver));

    // next_guid is a view function: it should not mutate outbound_nonce.
    assert_eq!(endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver), 0);
}

#[test]
fn test_next_guid_with_existing_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    // Set outbound nonce to 5, so next_guid should use nonce 6.
    set_outbound_nonce(&context, &sender, dst_eid, &receiver, 5);
    assert_eq!(endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver), 5);

    let guid = endpoint_client.next_guid(&sender, &dst_eid, &receiver);
    assert_eq!(guid, expected_guid(&context, 6, &sender, dst_eid, &receiver));

    // next_guid is a view function: it should not mutate outbound_nonce.
    assert_eq!(endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver), 5);
}

// Path isolation (sender/dst_eid/receiver are isolated)
#[test]
fn test_next_guid_isolated_by_sender_dst_eid_and_receiver() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender1 = Address::generate(env);
    let sender2 = Address::generate(env);
    let dst_eid = 2;
    let dst_eid_other = 3;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    let receiver_other = BytesN::from_array(env, &[2u8; 32]);

    // Different senders should produce different GUIDs (even with the same nonce).
    let guid_sender1 = endpoint_client.next_guid(&sender1, &dst_eid, &receiver);
    let guid_sender2 = endpoint_client.next_guid(&sender2, &dst_eid, &receiver);
    assert_ne!(guid_sender1, guid_sender2);
    assert_eq!(guid_sender1, expected_guid(&context, 1, &sender1, dst_eid, &receiver));
    assert_eq!(guid_sender2, expected_guid(&context, 1, &sender2, dst_eid, &receiver));

    // Different dst_eids should produce different GUIDs.
    let guid_dst1 = endpoint_client.next_guid(&sender1, &dst_eid, &receiver);
    let guid_dst2 = endpoint_client.next_guid(&sender1, &dst_eid_other, &receiver);
    assert_ne!(guid_dst1, guid_dst2);
    assert_eq!(guid_dst1, expected_guid(&context, 1, &sender1, dst_eid, &receiver));
    assert_eq!(guid_dst2, expected_guid(&context, 1, &sender1, dst_eid_other, &receiver));

    // Different receivers should produce different GUIDs.
    let guid_recv1 = endpoint_client.next_guid(&sender1, &dst_eid, &receiver);
    let guid_recv2 = endpoint_client.next_guid(&sender1, &dst_eid, &receiver_other);
    assert_ne!(guid_recv1, guid_recv2);
    assert_eq!(guid_recv1, expected_guid(&context, 1, &sender1, dst_eid, &receiver));
    assert_eq!(guid_recv2, expected_guid(&context, 1, &sender1, dst_eid, &receiver_other));
}
// The next_guid reflects outbound_nonce changes, but does not update outbound_nonce itself
#[test]
fn test_next_guid_after_outbound_increment() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    // Get initial GUID (should use nonce 1).
    let guid1 = endpoint_client.next_guid(&sender, &dst_eid, &receiver);
    assert_eq!(guid1, expected_guid(&context, 1, &sender, dst_eid, &receiver));

    // Simulate incrementing outbound nonce (as would happen in actual send).
    set_outbound_nonce(&context, &sender, dst_eid, &receiver, 1);

    // Get next GUID (should now use nonce 2).
    let guid2 = endpoint_client.next_guid(&sender, &dst_eid, &receiver);
    assert_eq!(guid2, expected_guid(&context, 2, &sender, dst_eid, &receiver));

    // Verify GUIDs are different.
    assert_ne!(guid1, guid2);
}

// Large nonce does not overflow when computing the next GUID
#[test]
fn test_next_guid_large_nonce() {
    let context = setup();
    let env = &context.env;
    let endpoint_client = &context.endpoint_client;

    let sender = Address::generate(env);
    let dst_eid = 2;
    let receiver = BytesN::from_array(env, &[1u8; 32]);
    let large_nonce = u64::MAX - 1;

    // Set outbound nonce to a large value so next_guid should use u64::MAX.
    set_outbound_nonce(&context, &sender, dst_eid, &receiver, large_nonce);
    assert_eq!(endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver), large_nonce);

    // Get next GUID (should use nonce u64::MAX).
    let guid = endpoint_client.next_guid(&sender, &dst_eid, &receiver);

    // Verify GUID is computed correctly with the large nonce.
    assert_eq!(guid, expected_guid(&context, u64::MAX, &sender, dst_eid, &receiver));

    // next_guid is a view function: it should not mutate outbound_nonce.
    assert_eq!(endpoint_client.outbound_nonce(&sender, &dst_eid, &receiver), large_nonce);
}
