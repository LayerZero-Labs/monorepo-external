use hex_literal::hex;
use soroban_sdk::{address_payload::AddressPayload, testutils::Address as _, Address, BytesN, Env};

use crate::{tests::endpoint_setup::setup, util::compute_guid};

#[test]
fn test_compute_guid_basic() {
    let context = setup();
    let env = &context.env;

    let nonce = 1u64;
    let src_eid = 1u32;
    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    let guid = compute_guid(env, nonce, src_eid, &sender, dst_eid, &receiver);

    // Verify that GUID is 32 bytes
    assert_eq!(guid.len(), 32);
}

#[test]
fn test_compute_guid() {
    let env = Env::default();

    let src_eid: u32 = 1;
    let dst_eid: u32 = 2;
    let nonce: u64 = 0x1234;

    // Create sender address from bytes32 (0x00...03)
    let sender_bytes = hex!("0000000000000000000000000000000000000000000000000000000000000003");
    let sender = Address::from_payload(&env, AddressPayload::ContractIdHash(BytesN::from_array(&env, &sender_bytes)));

    // Create receiver bytes32 (0x00...04)
    let receiver_bytes = hex!("0000000000000000000000000000000000000000000000000000000000000004");
    let receiver = BytesN::from_array(&env, &receiver_bytes);

    let guid = compute_guid(&env, nonce, src_eid, &sender, dst_eid, &receiver);

    // Expected GUID: 4e80f6fdccb10b2634b15fd900819c9d609ae2c61047ed47718f1dcca05587e4
    // (generated from Aptos)
    let expected_guid =
        BytesN::from_array(&env, &hex!("4e80f6fdccb10b2634b15fd900819c9d609ae2c61047ed47718f1dcca05587e4"));

    assert_eq!(guid, expected_guid);
}

#[test]
fn test_compute_guid_deterministic() {
    let context = setup();
    let env = &context.env;

    let nonce = 1u64;
    let src_eid = 1u32;
    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    // Compute GUID twice with same parameters
    let guid1 = compute_guid(env, nonce, src_eid, &sender, dst_eid, &receiver);
    let guid2 = compute_guid(env, nonce, src_eid, &sender, dst_eid, &receiver);

    // Should produce the same GUID
    assert_eq!(guid1, guid2);
}

#[test]
fn test_compute_guid_different_nonces() {
    let context = setup();
    let env = &context.env;

    let src_eid = 1u32;
    let sender = Address::generate(env);
    let dst_eid = 2u32;
    let receiver = BytesN::from_array(env, &[1u8; 32]);

    let guid1 = compute_guid(env, 1, src_eid, &sender, dst_eid, &receiver);
    let guid2 = compute_guid(env, 2, src_eid, &sender, dst_eid, &receiver);

    // Different nonces should produce different GUIDs
    assert_ne!(guid1, guid2);
}
