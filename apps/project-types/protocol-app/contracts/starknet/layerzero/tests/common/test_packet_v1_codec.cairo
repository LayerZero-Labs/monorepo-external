//! Test packet v1 codec

use layerzero::common::packet_v1_codec::PacketV1Codec;
use layerzero::common::packet_v1_codec::PacketV1Codec::{PacketPayload, PacketSenderBytes};
use layerzero::common::structs::packet::Packet;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::{Bytes32, ContractAddressIntoBytes32};
use snforge_std::fuzzable::{FuzzableU32, FuzzableU64, FuzzableU8};
use starknet::ContractAddress;
use crate::constants::assert_eq;
use crate::fuzzable::bytes32::FuzzableBytes32;
use crate::fuzzable::contract_address::FuzzableContractAddress;
use crate::fuzzable::eid::{Eid, FuzzableEid};
use crate::fuzzable::small_byte_array::FuzzableByteArray;

const MAX_U256: u256 = core::num::traits::Bounded::<u256>::MAX;

#[test]
#[fuzzer(runs: 10)]
fn test_encode_decode_packet(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };
    let encoded = PacketV1Codec::encode(@packet);

    // Verify decoding individual fields
    assert_eq(PacketV1Codec::version(@encoded), PacketV1Codec::PACKET_VERSION);
    assert_eq(PacketV1Codec::nonce(@encoded), nonce);
    assert_eq(PacketV1Codec::src_eid(@encoded), src_eid);
    assert_eq(PacketV1Codec::dst_eid(@encoded), dst_eid);
    assert_eq(PacketV1Codec::receiver(@encoded), receiver);
    assert_eq(PacketV1Codec::guid(@encoded), guid);
    assert_eq(PacketV1Codec::message(@encoded), message);
}

#[test]
#[fuzzer(runs: 10)]
fn test_encode_packet_header(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet { nonce, src_eid, sender, dst_eid, receiver, guid, message };

    // Header should be exactly 81 bytes (up to GUID_OFFSET)
    let header = PacketV1Codec::encode_header(@packet);
    assert_eq(header.len(), PacketV1Codec::GUID_OFFSET);

    // Verify header extraction from full packet
    let encoded = PacketV1Codec::encode(@packet);
    assert_eq(PacketV1Codec::header(@encoded), header);
}

#[test]
#[fuzzer(runs: 10)]
fn test_encode_payload(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    // Verify payload extraction from full packet
    let encoded = PacketV1Codec::encode(@packet);
    let payload = PacketV1Codec::payload(@encoded);
    assert_eq(PacketV1Codec::encode_payload(@packet), payload);
}

#[test]
#[fuzzer(runs: 10)]
fn test_payload_hash(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    // Payload hash should not be zero
    let encoded = PacketV1Codec::encode(@packet);
    let payload_hash = PacketV1Codec::payload_hash(@encoded);
    assert(payload_hash.value != 0, 'Should not be zero');
}

#[test]
#[fuzzer(runs: 10)]
fn test_sender_address_conversion(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    // Should be able to decode the sender address
    let encoded = PacketV1Codec::encode(@packet);
    let decoded_sender = PacketV1Codec::sender_address(@encoded);
    assert_eq(decoded_sender, sender);
}

#[test]
#[fuzzer(runs: 10)]
#[should_panic(expected: "LZ_PACKET_V1_CODEC_INVALID_SENDER_ADDRESS")]
fn test_invalid_sender_address(random_8_bytes: u64, random_4_bytes: u32, random_byte: u8) {
    // This will fail since its not a valid felt252, so its not a valid contract address
    let mut encoded: ByteArray = Default::default();
    // adding 13 bytes since its the sender offset
    encoded.append_u64(random_8_bytes);
    encoded.append_u32(random_4_bytes);
    encoded.append_u8(random_byte);
    encoded.append_u256(MAX_U256);
    // this should return the expected error
    PacketV1Codec::sender_address(@encoded);
}


#[test]
#[fuzzer(runs: 10)]
fn test_receiver_address_conversion(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver_bytes = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver: receiver_bytes, guid, message: message.clone(),
    };

    // Should be able to decode the receiver address
    let encoded = PacketV1Codec::encode(@packet);
    let decoded_receiver = PacketV1Codec::receiver_address(@encoded);
    assert_eq(decoded_receiver, receiver);
}

#[test]
#[fuzzer(runs: 10)]
#[should_panic(expected: "LZ_PACKET_V1_CODEC_INVALID_RECEIVER_ADDRESS")]
fn test_invalid_receiver_address(
    sender: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let receiver_max = Bytes32 { value: MAX_U256 };
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver: receiver_max, guid, message: message.clone(),
    };

    // Should be able to decode the receiver address
    let encoded = PacketV1Codec::encode(@packet);
    PacketV1Codec::receiver_address(@encoded);
}


#[test]
#[fuzzer(runs: 10)]
fn test_decode_payload(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    let encoded = PacketV1Codec::encode(@packet);
    let PacketPayload {
        guid: decoded_guid, message: decoded_message,
    } = PacketV1Codec::decode_payload(@encoded);

    // Verify payload fields match
    assert_eq(decoded_guid, packet.guid);
    assert_eq(decoded_message, message);
}

#[test]
#[fuzzer(runs: 10)]
fn test_decode_full_packet(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    // Roundtrip
    let encoded = PacketV1Codec::encode(@packet);
    let decoded = PacketV1Codec::decode(@encoded);

    // Verify all fields match exactly
    assert_eq(decoded.nonce, packet.nonce);
    assert_eq(decoded.src_eid, packet.src_eid);
    assert_eq(decoded.sender, packet.sender);
    assert_eq(decoded.dst_eid, packet.dst_eid);
    assert_eq(decoded.receiver, packet.receiver);
    assert_eq(decoded.guid, packet.guid);
    assert_eq(decoded.message, packet.message);
}

#[test]
#[fuzzer(runs: 10)]
fn test_decode_with_bytes32_sender(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    let encoded = PacketV1Codec::encode(@packet);
    let PacketSenderBytes {
        nonce,
        src_eid,
        sender: sender_bytes,
        dst_eid,
        receiver: receiver_bytes,
        guid: guid_bytes,
        message: decoded_message,
    } = PacketV1Codec::decode_with_bytes32_sender(@encoded);

    // Verify all fields match
    assert_eq(nonce, packet.nonce);
    assert_eq(src_eid, packet.src_eid);
    assert_eq(dst_eid, packet.dst_eid);
    assert_eq(receiver_bytes, packet.receiver);
    assert_eq(guid_bytes, packet.guid);
    assert_eq(decoded_message, message);

    // Verify sender can be converted back
    assert_eq(sender_bytes.try_into().unwrap(), packet.sender);
}

#[test]
#[fuzzer(runs: 10)]
fn test_encode_decode_roundtrip(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    // Roundtrip
    let encoded = PacketV1Codec::encode(@packet);
    let decoded = PacketV1Codec::decode(@encoded);

    // Verify perfect roundtrip
    assert_eq(decoded.nonce, packet.nonce);
    assert_eq(decoded.src_eid, packet.src_eid);
    assert_eq(decoded.sender, packet.sender);
    assert_eq(decoded.dst_eid, packet.dst_eid);
    assert_eq(decoded.receiver, packet.receiver);
    assert_eq(decoded.guid, packet.guid);
    assert_eq(decoded.message, packet.message);
}

#[test]
#[should_panic(expected: "LZ_PACKET_V1_CODEC_INVALID_PACKET_VERSION")]
#[fuzzer(runs: 10)]
fn test_decode_invalid_version(
    sender: ContractAddress,
    receiver: ContractAddress,
    nonce: u64,
    guid: Bytes32,
    src_eid: Eid,
    dst_eid: Eid,
    message: ByteArray,
) {
    let src_eid = src_eid.eid;
    let dst_eid = dst_eid.eid;
    let receiver = receiver.into();
    let packet = Packet {
        nonce, src_eid, sender, dst_eid, receiver, guid, message: message.clone(),
    };

    let mut encoded = PacketV1Codec::encode(@packet);

    // Corrupt the version byte (first byte should be 1, change it to 2)
    // We need to manually modify the first byte
    let mut corrupted_encoded: ByteArray = Default::default();
    corrupted_encoded.append_u8(2); // Invalid version

    // Append the rest of the packet (skip the first byte)
    for i in 1..encoded.len() {
        corrupted_encoded.append_u8(encoded.at(i).unwrap());
    }

    // This should panic with "Invalid packet version"
    PacketV1Codec::decode(@corrupted_encoded);
}
