use super::test_helper::*;
use crate::packet_codec_v1::{decode_packet_header, encode_packet_header, HEADER_LENGTH, PACKET_VERSION};
use endpoint_v2::{util::compute_guid, OutboundPacket};
use soroban_sdk::{address_payload::AddressPayload, Address, Bytes, BytesN, Env};

#[test]
fn test_encode_packet_header_has_expected_length_and_byte_layout() {
    let env = Env::default();
    let packet = create_test_outbound_packet(&env);

    // Validate the byte layout (offsets + endianness).

    let encoded = encode_packet_header(&env, &packet);
    assert_eq!(encoded.len(), HEADER_LENGTH);

    // Offsets:
    // [0] version
    // [1..9] nonce (u64 BE)
    // [9..13] src_eid (u32 BE)
    // [13..45] sender (32)
    // [45..49] dst_eid (u32 BE)
    // [49..81] receiver (32)

    assert_eq!(encoded.get(0).unwrap(), PACKET_VERSION);

    let nonce_bytes = encoded.slice(1..9);
    assert_eq!(nonce_bytes, Bytes::from_slice(&env, &TEST_NONCE.to_be_bytes()));

    let src_eid_bytes = encoded.slice(9..13);
    assert_eq!(src_eid_bytes, Bytes::from_slice(&env, &TEST_SRC_EID.to_be_bytes()));

    let sender_bytes = encoded.slice(13..45);
    assert_eq!(sender_bytes, Bytes::from_slice(&env, &TEST_SENDER_BYTES));

    let dst_eid_bytes = encoded.slice(45..49);
    assert_eq!(dst_eid_bytes, Bytes::from_slice(&env, &TEST_DST_EID.to_be_bytes()));

    let receiver_bytes = encoded.slice(49..81);
    assert_eq!(receiver_bytes, Bytes::from_slice(&env, &TEST_RECEIVER_BYTES));
}

#[test]
fn test_encode_packet_header_roundtrips_through_decode_packet_header() {
    let env = Env::default();
    let packet = create_test_outbound_packet(&env);

    let encoded_header = encode_packet_header(&env, &packet);
    let decoded_header = decode_packet_header(&env, &encoded_header);

    assert_eq!(decoded_header.version, PACKET_VERSION);
    assert_eq!(decoded_header.nonce, TEST_NONCE);
    assert_eq!(decoded_header.src_eid, TEST_SRC_EID);
    assert_eq!(decoded_header.dst_eid, TEST_DST_EID);
    assert_eq!(decoded_header.sender, BytesN::from_array(&env, &TEST_SENDER_BYTES));
    assert_eq!(decoded_header.receiver, BytesN::from_array(&env, &TEST_RECEIVER_BYTES));
}

#[test]
fn test_encode_packet_header_sender_account_address_writes_payload_only() {
    let env = Env::default();

    let account_pk: [u8; 32] = [0xA5; 32];
    let sender =
        Address::from_payload(&env, AddressPayload::AccountIdPublicKeyEd25519(BytesN::from_array(&env, &account_pk)));

    let receiver = BytesN::from_array(&env, &TEST_RECEIVER_BYTES);
    let guid = compute_guid(&env, TEST_NONCE, TEST_SRC_EID, &sender, TEST_DST_EID, &receiver);

    let packet = OutboundPacket {
        nonce: TEST_NONCE,
        src_eid: TEST_SRC_EID,
        sender,
        dst_eid: TEST_DST_EID,
        receiver,
        guid,
        message: Bytes::new(&env),
    };

    let encoded = encode_packet_header(&env, &packet);
    assert_eq!(encoded.len(), HEADER_LENGTH);
    assert_eq!(encoded.get(0).unwrap(), PACKET_VERSION);

    // Sender field is [13..45] and must contain only the 32-byte payload (no type byte).
    let sender_bytes = encoded.slice(13..45);
    assert_eq!(sender_bytes, Bytes::from_slice(&env, &account_pk));

    // Roundtrip sanity.
    let decoded = decode_packet_header(&env, &encoded);
    assert_eq!(decoded.sender, BytesN::from_array(&env, &account_pk));
}

#[test]
fn test_encode_packet_header_ignores_guid_and_message() {
    let env = Env::default();
    let packet = create_test_outbound_packet(&env);

    let different_packet = OutboundPacket {
        nonce: packet.nonce,
        src_eid: packet.src_eid,
        sender: packet.sender.clone(),
        dst_eid: packet.dst_eid,
        receiver: packet.receiver.clone(),
        guid: BytesN::from_array(&env, &[0xAB; 32]),
        message: Bytes::from_array(&env, &[0xDE, 0xAD, 0xBE, 0xEF]),
    };

    assert_eq!(encode_packet_header(&env, &packet), encode_packet_header(&env, &different_packet));
}

#[test]
fn test_encode_packet_header_numeric_boundaries_are_big_endian() {
    let env = Env::default();

    // Reuse the same sender/receiver shapes as other tests (contract sender).
    let sender =
        Address::from_payload(&env, AddressPayload::ContractIdHash(BytesN::from_array(&env, &TEST_SENDER_BYTES)));
    let receiver = BytesN::from_array(&env, &TEST_RECEIVER_BYTES);

    for (nonce, src_eid, dst_eid) in [(0u64, 0u32, 0u32), (u64::MAX, u32::MAX, u32::MAX)] {
        let guid = compute_guid(&env, nonce, src_eid, &sender, dst_eid, &receiver);
        let packet = OutboundPacket {
            nonce,
            src_eid,
            sender: sender.clone(),
            dst_eid,
            receiver: receiver.clone(),
            guid,
            message: Bytes::new(&env),
        };

        let encoded = encode_packet_header(&env, &packet);
        assert_eq!(encoded.get(0).unwrap(), PACKET_VERSION);

        assert_eq!(encoded.slice(1..9), Bytes::from_slice(&env, &nonce.to_be_bytes()));
        assert_eq!(encoded.slice(9..13), Bytes::from_slice(&env, &src_eid.to_be_bytes()));
        assert_eq!(encoded.slice(45..49), Bytes::from_slice(&env, &dst_eid.to_be_bytes()));
    }
}
