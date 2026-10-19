// Shared constants and helpers for packet_codec_v1 tests.

use crate::packet_codec_v1::{decode_packet_header, PacketHeader, HEADER_LENGTH};
use endpoint_v2::{util::compute_guid, OutboundPacket};
use soroban_sdk::{address_payload::AddressPayload, Address, Bytes, BytesN, Env};
use utils::buffer_reader::BufferReader;

pub(super) const TEST_SRC_EID: u32 = 101;
pub(super) const TEST_DST_EID: u32 = 102;
pub(super) const TEST_NONCE: u64 = 0x123456789abcdef0;
pub(super) const TEST_MESSAGE: [u8; 5] = hex_literal::hex!("0102030405");

// @0x1234567890abcdef1234567890abcdef12345678 padded to 32 bytes
pub(super) const TEST_SENDER_BYTES: [u8; 32] =
    hex_literal::hex!("0000000000000000000000001234567890abcdef1234567890abcdef12345678");

// @0x9876543210fedcba9876543210fedcba98765432 padded to 32 bytes
pub(super) const TEST_RECEIVER_BYTES: [u8; 32] =
    hex_literal::hex!("0000000000000000000000009876543210fedcba9876543210fedcba98765432");

pub(super) fn create_test_outbound_packet(env: &Env) -> OutboundPacket {
    create_test_outbound_packet_with_message(env, Bytes::from_array(env, &TEST_MESSAGE))
}

pub(super) fn create_test_outbound_packet_with_message(env: &Env, message: Bytes) -> OutboundPacket {
    let sender =
        Address::from_payload(env, AddressPayload::ContractIdHash(BytesN::from_array(env, &TEST_SENDER_BYTES)));
    let receiver = BytesN::from_array(env, &TEST_RECEIVER_BYTES);
    let guid = compute_guid(env, TEST_NONCE, TEST_SRC_EID, &sender, TEST_DST_EID, &receiver);
    OutboundPacket { nonce: TEST_NONCE, src_eid: TEST_SRC_EID, sender, dst_eid: TEST_DST_EID, receiver, guid, message }
}

pub(super) fn decode_packet_for_test(env: &Env, encoded: &Bytes) -> (PacketHeader, BytesN<32>, Bytes) {
    let mut reader = BufferReader::new(encoded);
    let header = decode_packet_header(env, &reader.read_bytes(HEADER_LENGTH));
    let guid = reader.read_bytes_n();
    let message = reader.read_bytes_until_end();
    (header, guid, message)
}
