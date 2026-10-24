mod commit_verification;
mod confirmations;
mod effective_receive_uln_config;
mod set_default_receive_uln_configs;
mod verifiable;
mod verify;

// Helper functions for receive tests
use endpoint_v2::OutboundPacket;
use message_lib_common::packet_codec_v1;
use soroban_sdk::{address_payload::AddressPayload, testutils::Address as _, Address, Bytes, BytesN, Env};

use crate::tests::setup::{LOCAL_EID, REMOTE_EID};

/// Helper to extract BytesN<32> payload from an Address
fn address_to_bytes32(address: &Address) -> BytesN<32> {
    match address.to_payload().unwrap() {
        AddressPayload::AccountIdPublicKeyEd25519(payload) => payload,
        AddressPayload::ContractIdHash(payload) => payload,
    }
}

pub const NONCE: u64 = 12345;
pub const CONFIRMATIONS: u64 = 20;

/// Creates a valid test packet header
pub fn create_test_packet_header(env: &Env, receiver: &Address) -> Bytes {
    let sender = Address::generate(env);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let message = Bytes::from_array(env, &[0x01, 0x02, 0x03, 0x04]);

    let packet = OutboundPacket {
        nonce: NONCE,
        src_eid: REMOTE_EID,
        sender: sender.clone(),
        dst_eid: LOCAL_EID,
        receiver: address_to_bytes32(receiver),
        guid,
        message,
    };
    packet_codec_v1::encode_packet_header(env, &packet)
}

/// Creates a test packet header with custom EID (for invalid EID tests)
pub fn create_test_packet_header_with_eid(env: &Env, receiver: &Address, dst_eid: u32) -> Bytes {
    let sender = Address::generate(env);
    let guid = BytesN::from_array(env, &[5u8; 32]);
    let message = Bytes::from_array(env, &[0x01, 0x02, 0x03, 0x04]);

    let packet = OutboundPacket {
        nonce: NONCE,
        src_eid: REMOTE_EID,
        sender: sender.clone(),
        dst_eid,
        receiver: address_to_bytes32(receiver),
        guid,
        message,
    };
    packet_codec_v1::encode_packet_header(env, &packet)
}

/// Creates a test payload hash
pub fn create_test_payload_hash(env: &Env) -> BytesN<32> {
    let random_data = Bytes::from_array(env, &[0xde, 0xad, 0xbe, 0xef]);
    endpoint_v2::util::keccak256(env, &random_data)
}
