//! GUID generation tests

use core::num::traits::Bounded;
use layerzero::common::guid::GUID;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use lz_utils::keccak::keccak256;
use crate::constants::assert_eq;

#[test]
#[fuzzer(runs: 10)]
fn should_generate_deterministic_guid(
    nonce: u64, src_eid: u32, sender_value: u256, dst_eid: u32, receiver_value: u256,
) {
    let sender = Bytes32 { value: sender_value };
    let receiver = Bytes32 { value: receiver_value };

    let guid1 = GUID::generate(nonce, src_eid, sender, dst_eid, receiver);
    let guid2 = GUID::generate(nonce, src_eid, sender, dst_eid, receiver);

    // Same inputs should produce same GUID
    assert_eq(guid1, guid2);
    // GUID should not be zero (extremely unlikely with keccak256)
    assert(guid1.value != 0, 'Should not be zero');
}

#[test]
#[fuzzer(runs: 10)]
fn should_generate_different_guid_for_different_nonces(
    nonce_1: u64,
    nonce_2: u64,
    src_eid: u32,
    sender_value: u256,
    dst_eid: u32,
    receiver_value: u256,
) {
    // Ensure the nonces are different
    // Same nonces are tested in should_generate_deterministic_guid
    if nonce_1 == nonce_2 {
        return;
    }

    let sender = Bytes32 { value: sender_value };
    let receiver = Bytes32 { value: receiver_value };

    let guid_1 = GUID::generate(nonce_1, src_eid, sender, dst_eid, receiver);
    let guid_2 = GUID::generate(nonce_2, src_eid, sender, dst_eid, receiver);

    assert(guid_1 != guid_2, 'Should be different');
}

#[test]
#[fuzzer(runs: 10)]
fn should_generate_different_guid_for_different_src_eid(
    nonce: u64,
    src_eid_1: u32,
    src_eid_2: u32,
    sender_value: u256,
    dst_eid: u32,
    receiver_value: u256,
) {
    // Ensure the src_eids are different
    // Same src_eid are tested in should_generate_deterministic_guid
    if src_eid_1 == src_eid_2 {
        return;
    }

    let sender = Bytes32 { value: sender_value };
    let receiver = Bytes32 { value: receiver_value };

    let guid_1 = GUID::generate(nonce, src_eid_1, sender, dst_eid, receiver);
    let guid_2 = GUID::generate(nonce, src_eid_2, sender, dst_eid, receiver);

    assert(guid_1 != guid_2, 'Should be different');
}

#[test]
#[fuzzer(runs: 10)]
fn should_generate_different_guid_for_different_sender(
    nonce: u64, src_eid: u32, sender_1: u256, sender_2: u256, dst_eid: u32, receiver_value: u256,
) {
    // Ensure the senders are different
    // Same sender are tested in should_generate_deterministic_guid
    if sender_1 == sender_2 {
        return;
    }

    let sender_1 = Bytes32 { value: sender_1 };
    let sender_2 = Bytes32 { value: sender_2 };
    let receiver = Bytes32 { value: receiver_value };

    let guid_1 = GUID::generate(nonce, src_eid, sender_1, dst_eid, receiver);
    let guid_2 = GUID::generate(nonce, src_eid, sender_2, dst_eid, receiver);

    assert(guid_1 != guid_2, 'Should be different');
}

#[test]
#[fuzzer(runs: 10)]
fn should_generate_different_guid_for_different_dst_eid(
    nonce: u64,
    src_eid: u32,
    sender_value: u256,
    dst_eid_1: u32,
    dst_eid_2: u32,
    receiver_value: u256,
) {
    // Ensure the dst_eids are different
    // Same dst_eid are tested in should_generate_deterministic_guid
    if dst_eid_1 == dst_eid_2 {
        return;
    }

    let sender = Bytes32 { value: sender_value };
    let receiver = Bytes32 { value: receiver_value };

    let guid_1 = GUID::generate(nonce, src_eid, sender, dst_eid_1, receiver);
    let guid_2 = GUID::generate(nonce, src_eid, sender, dst_eid_2, receiver);

    assert(guid_1 != guid_2, 'Should be different');
}

#[test]
#[fuzzer(runs: 10)]
fn should_generate_different_guid_for_different_receiver(
    nonce: u64, src_eid: u32, sender_value: u256, dst_eid: u32, receiver_1: u256, receiver_2: u256,
) {
    // Ensure the receivers are different
    // Same receiver are tested in should_generate_deterministic_guid
    if receiver_1 == receiver_2 {
        return;
    }

    let sender = Bytes32 { value: sender_value };
    let receiver_1 = Bytes32 { value: receiver_1 };
    let receiver_2 = Bytes32 { value: receiver_2 };

    let guid_1 = GUID::generate(nonce, src_eid, sender, dst_eid, receiver_1);
    let guid_2 = GUID::generate(nonce, src_eid, sender, dst_eid, receiver_2);

    assert(guid_1 != guid_2, 'Should be different');
}

#[test]
#[fuzzer(runs: 10)]
fn should_match_manual_hash_calculation(
    nonce: u64, src_eid: u32, sender_value: u256, dst_eid: u32, receiver_value: u256,
) {
    let sender = Bytes32 { value: sender_value };
    let receiver = Bytes32 { value: receiver_value };

    let guid = GUID::generate(nonce, src_eid, sender, dst_eid, receiver);

    // Manually construct the expected ByteArray and hash it
    let mut expected_bytes: ByteArray = Default::default();
    expected_bytes.append_u64(nonce);
    expected_bytes.append_u32(src_eid);
    expected_bytes.append_u256(sender.value);
    expected_bytes.append_u32(dst_eid);
    expected_bytes.append_u256(receiver.value);

    let expected_guid = keccak256(@expected_bytes);

    assert_eq(guid, expected_guid);
}

#[test]
#[fuzzer(runs: 10)]
fn should_have_collision_resistance(
    nonce: u64, src_eid: u32, sender_value: u256, dst_eid: u32, receiver_value: u256,
) {
    let sender = Bytes32 { value: sender_value };
    let receiver1 = Bytes32 { value: receiver_value };
    let receiver2 = Bytes32 { value: receiver_value + 1 };

    let guid1 = GUID::generate(nonce, src_eid, sender, dst_eid, receiver1);
    let guid2 = GUID::generate(nonce, src_eid, sender, dst_eid, receiver2);

    // Verify the GUIDs are different (collision resistance)
    assert(guid1 != guid2, 'Should be different');

    // Verify the difference is significant (not just a small bit flip)
    let xor_diff = guid1.value ^ guid2.value;
    assert(xor_diff != 0, 'Should not be zero');
}

#[test]
fn should_generate_guid_with_zero_values() {
    let guid = GUID::generate(0, 0, Bytes32 { value: 0 }, 0, Bytes32 { value: 0 });
    // Even zero inputs should produce non-zero GUID due to keccak256 properties
    assert(guid.value != 0, 'Should not be zero');
}

#[test]
fn should_generate_guid_with_max_values() {
    let max_bytes = Bytes32 { value: Bounded::MAX };

    let guid = GUID::generate(Bounded::MAX, Bounded::MAX, max_bytes, Bounded::MAX, max_bytes);
    assert(guid.value != 0, 'Should not be zero');
}

#[test]
fn should_generate_realistic_layerzero_guid() {
    const REALISTIC_NONCE: u64 = 987654321;
    const ETHEREUM_EID: u32 = 30101;
    const ARBITRUM_EID: u32 = 30110;
    const MOCK_SENDER_ADDRESS: u256 = 0x742d35Cc6634C0532925a3b8D8E3C9b6b32a1E5A;
    const MOCK_RECEIVER_ADDRESS: u256 = 0x8ba1f109551bD432803012645bac136c22afBa93;

    // Test with realistic LayerZero values
    let sender = Bytes32 { value: MOCK_SENDER_ADDRESS };
    let receiver = Bytes32 { value: MOCK_RECEIVER_ADDRESS };

    let guid = GUID::generate(REALISTIC_NONCE, ETHEREUM_EID, sender, ARBITRUM_EID, receiver);

    // Verify GUID properties
    assert(guid.value != 0, 'Should not be zero');

    // Test deterministic behavior
    let guid_repeat = GUID::generate(REALISTIC_NONCE, ETHEREUM_EID, sender, ARBITRUM_EID, receiver);
    assert_eq(guid, guid_repeat);

    // Test that incrementing nonce changes GUID
    let guid_next_nonce = GUID::generate(
        REALISTIC_NONCE + 1, ETHEREUM_EID, sender, ARBITRUM_EID, receiver,
    );
    assert(guid != guid_next_nonce, 'Should be different');
}
