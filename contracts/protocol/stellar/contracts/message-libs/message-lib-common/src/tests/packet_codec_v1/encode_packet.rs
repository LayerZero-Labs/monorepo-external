use super::test_helper::*;
use crate::packet_codec_v1::{encode_packet, encode_packet_header, HEADER_LENGTH};
use soroban_sdk::{Bytes, BytesN, Env};
use utils::buffer_reader::BufferReader;

#[test]
fn test_encode_packet_layout_and_length() {
    let env = Env::default();
    let packet = create_test_outbound_packet(&env);

    // Layout: [header (81)] + [guid (32)] + [message (variable)].

    let encoded = encode_packet(&env, &packet);
    assert_eq!(encoded.len(), HEADER_LENGTH + 32 + packet.message.len());

    let mut reader = BufferReader::new(&encoded);
    let encoded_header: Bytes = reader.read_bytes(HEADER_LENGTH);
    let encoded_guid: BytesN<32> = reader.read_bytes_n();
    let encoded_message: Bytes = reader.read_bytes_until_end();

    assert_eq!(encoded_header, encode_packet_header(&env, &packet));
    assert_eq!(encoded_guid, packet.guid);
    assert_eq!(encoded_message, packet.message);
}

#[test]
fn test_encode_packet_supports_empty_message() {
    let env = Env::default();
    let packet = create_test_outbound_packet_with_message(&env, Bytes::new(&env));

    let encoded = encode_packet(&env, &packet);
    let (header, guid, message) = decode_packet_for_test(&env, &encoded);

    assert_eq!(header.src_eid, TEST_SRC_EID);
    assert_eq!(guid, packet.guid);
    assert_eq!(message.len(), 0);
}

#[test]
fn test_encode_packet_supports_large_message() {
    let env = Env::default();

    // 1KB message.
    let mut large_msg_array = [0u8; 1024];
    for (i, byte) in large_msg_array.iter_mut().enumerate() {
        *byte = (i % 256) as u8;
    }

    let large_message = Bytes::from_slice(&env, &large_msg_array);
    let packet = create_test_outbound_packet_with_message(&env, large_message.clone());

    let encoded = encode_packet(&env, &packet);
    let (header, guid, message) = decode_packet_for_test(&env, &encoded);

    assert_eq!(header.src_eid, TEST_SRC_EID);
    assert_eq!(guid, packet.guid);
    assert_eq!(message, large_message);
}
