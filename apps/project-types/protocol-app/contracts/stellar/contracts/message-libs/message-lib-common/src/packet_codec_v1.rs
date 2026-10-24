use endpoint_v2::{util, OutboundPacket};
use soroban_sdk::{assert_with_error, Bytes, BytesN, Env};
use utils::{buffer_reader::BufferReader, buffer_writer::BufferWriter};

use crate::errors::PacketCodecV1Error;

pub const PACKET_VERSION: u8 = 1;
pub const HEADER_LENGTH: u32 = 81;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PacketHeader {
    pub version: u8,
    pub nonce: u64,
    pub src_eid: u32,
    pub sender: BytesN<32>,
    pub dst_eid: u32,
    pub receiver: BytesN<32>,
}

/// Encodes a complete outbound packet including header, GUID, and message.
///
/// Packet layout: [header (81 bytes)] + [guid (32 bytes)] + [message (variable)]
///
/// # Arguments
/// * `packet` - The outbound packet containing routing info and message
///
/// # Returns
/// Encoded packet bytes ready for cross-chain transmission
pub fn encode_packet(env: &Env, packet: &OutboundPacket) -> Bytes {
    let mut writer = BufferWriter::from_bytes(encode_packet_header(env, packet));
    writer.write_bytes_n(&packet.guid).write_bytes(&packet.message).to_bytes()
}

/// Encodes only the packet header from an outbound packet.
///
/// Header layout (81 bytes):
/// - `[0]`: version (1 byte)
/// - `[1..9]`: nonce (8 bytes, big-endian)
/// - `[9..13]`: src_eid (4 bytes, big-endian)
/// - `[13..45]`: sender (32 bytes)
/// - `[45..49]`: dst_eid (4 bytes, big-endian)
/// - `[49..81]`: receiver (32 bytes)
///
/// # Arguments
/// * `packet` - The outbound packet to encode header from
///
/// # Returns
/// Encoded 81-byte packet header
pub fn encode_packet_header(env: &Env, packet: &OutboundPacket) -> Bytes {
    let mut writer = BufferWriter::new(env);
    writer
        .write_u8(PACKET_VERSION)
        .write_u64(packet.nonce)
        .write_u32(packet.src_eid)
        .write_address_payload(&packet.sender)
        .write_u32(packet.dst_eid)
        .write_bytes_n(&packet.receiver)
        .to_bytes()
}

/// Decodes a byte vector into a packet header and validates the format.
///
/// Validates header length (81 bytes) and packet version before decoding.
///
/// # Arguments
/// * `encoded_header` - The raw 81-byte packet header
///
/// # Returns
/// Decoded `PacketHeader` struct with version, nonce, src_eid, sender, dst_eid, receiver
pub fn decode_packet_header(env: &Env, encoded_header: &Bytes) -> PacketHeader {
    assert_with_error!(env, encoded_header.len() == HEADER_LENGTH, PacketCodecV1Error::InvalidPacketHeader);

    let mut reader = BufferReader::new(encoded_header);
    let packet_version = reader.read_u8();
    assert_with_error!(env, packet_version == PACKET_VERSION, PacketCodecV1Error::InvalidPacketVersion);

    let nonce = reader.read_u64();
    let src_eid = reader.read_u32();
    let sender = reader.read_bytes_n();
    let dst_eid = reader.read_u32();
    let receiver = reader.read_bytes_n();

    PacketHeader { version: PACKET_VERSION, nonce, src_eid, sender, dst_eid, receiver }
}

/// Returns the payload (GUID + message) from an outbound packet.
pub fn payload(env: &Env, packet: &OutboundPacket) -> Bytes {
    util::build_payload(env, &packet.guid, &packet.message)
}

/// Returns the keccak256 hash of the packet payload.
pub fn payload_hash(env: &Env, packet: &OutboundPacket) -> BytesN<32> {
    util::keccak256(env, &payload(env, packet))
}
