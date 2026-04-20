use super::test_helper::*;
use crate::packet_codec_v1::{decode_packet_header, HEADER_LENGTH, PACKET_VERSION};
use soroban_sdk::{Bytes, BytesN, Env};

#[test]
#[should_panic(expected = "Error(Contract, #1100)")] // PacketCodecV1Error::InvalidPacketHeader
fn test_decode_packet_header_rejects_invalid_length() {
    let env = Env::default();
    // Only 3 bytes instead of HEADER_LENGTH.
    let invalid_header = Bytes::from_array(&env, &[0x01, 0x02, 0x03]);
    decode_packet_header(&env, &invalid_header);
}

#[test]
#[should_panic(expected = "Error(Contract, #1101)")] // PacketCodecV1Error::InvalidPacketVersion
fn test_decode_packet_header_rejects_invalid_version() {
    let env = Env::default();
    // Correct length, wrong version.
    let mut invalid_header_bytes: [u8; HEADER_LENGTH as usize] = [0u8; HEADER_LENGTH as usize];
    invalid_header_bytes[0] = 2; // Wrong version (should be 1)
    let invalid_header = Bytes::from_array(&env, &invalid_header_bytes);
    decode_packet_header(&env, &invalid_header);
}

#[test]
#[should_panic(expected = "Error(Contract, #1100)")] // PacketCodecV1Error::InvalidPacketHeader
fn test_decode_packet_header_rejects_too_long_length() {
    let env = Env::default();
    // HEADER_LENGTH + 1 bytes should still be rejected (length must be exactly HEADER_LENGTH).
    let too_long_header = Bytes::from_array(&env, &[0u8; (HEADER_LENGTH as usize) + 1]);
    decode_packet_header(&env, &too_long_header);
}

#[test]
fn test_decode_packet_header_parses_expected_offsets_and_big_endian() {
    let env = Env::default();

    // Construct raw header bytes directly (do not depend on encode_packet_header).
    // Layout:
    // [0] version
    // [1..9] nonce (u64 BE)
    // [9..13] src_eid (u32 BE)
    // [13..45] sender (32)
    // [45..49] dst_eid (u32 BE)
    // [49..81] receiver (32)
    let mut raw: [u8; HEADER_LENGTH as usize] = [0u8; HEADER_LENGTH as usize];
    raw[0] = PACKET_VERSION;

    raw[1..9].copy_from_slice(&TEST_NONCE.to_be_bytes());
    raw[9..13].copy_from_slice(&TEST_SRC_EID.to_be_bytes());
    raw[13..45].copy_from_slice(&TEST_SENDER_BYTES);
    raw[45..49].copy_from_slice(&TEST_DST_EID.to_be_bytes());
    raw[49..81].copy_from_slice(&TEST_RECEIVER_BYTES);

    let encoded_header = Bytes::from_array(&env, &raw);
    let decoded = decode_packet_header(&env, &encoded_header);

    assert_eq!(decoded.version, PACKET_VERSION);
    assert_eq!(decoded.nonce, TEST_NONCE);
    assert_eq!(decoded.src_eid, TEST_SRC_EID);
    assert_eq!(decoded.dst_eid, TEST_DST_EID);
    assert_eq!(decoded.sender, BytesN::from_array(&env, &TEST_SENDER_BYTES));
    assert_eq!(decoded.receiver, BytesN::from_array(&env, &TEST_RECEIVER_BYTES));
}
