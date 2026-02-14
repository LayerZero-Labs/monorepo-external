//! OFT message codec tests

use layerzero::oapps::oft::oft_msg_codec::OFTMsgCodec;
use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

// ===== ENCODE TESTS =====

#[test]
fn test_encode_simple_message() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, has_compose) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);

    assert(!has_compose, 'Should not have compose');
    assert(message.len() == 40, 'Message length should be 40'); // 32 + 8 bytes
}

#[test]
fn test_encode_composed_message() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;
    let mut compose_msg: ByteArray = Default::default();
    compose_msg.append_byte(0x01);
    compose_msg.append_byte(0x02);

    let (message, has_compose) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);

    assert(has_compose, 'Should have compose');
    assert(message.len() > 40, 'Message too short');
}

#[test]
fn test_encode_zero_amount() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 0_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, has_compose) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);

    assert(!has_compose, 'Should not have compose');
    assert(message.len() == 40, 'Message length should be 40');
    assert(OFTMsgCodec::amount_sd(@message) == 0, 'Amount should be zero');
}

#[test]
fn test_encode_max_amount() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 0xffffffffffffffff_u64; // Max u64
    let compose_msg: ByteArray = Default::default();

    let (message, has_compose) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);

    assert(!has_compose, 'Should not have compose');
    assert(OFTMsgCodec::amount_sd(@message) == 0xffffffffffffffff_u64, 'Amount should be max');
}

#[test]
fn test_encode_zero_address() {
    let send_to = Bytes32 { value: 0 };
    let amount_shared = 1000_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, _) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);
    let decoded_send_to = OFTMsgCodec::send_to(@message);

    assert(decoded_send_to.value == 0, 'Zero address should work');
}

// ===== IS_COMPOSED TESTS =====

#[test]
fn test_is_composed() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;

    // Test simple message
    let compose_msg_empty: ByteArray = Default::default();
    let (message_simple, _) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg_empty);
    assert(!OFTMsgCodec::is_composed(@message_simple), 'Simple not composed');

    // Test composed message
    let mut compose_msg: ByteArray = Default::default();
    compose_msg.append_byte(0x01);
    let (message_composed, _) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);
    assert(OFTMsgCodec::is_composed(@message_composed), 'Composed msg should be composed');
}

// ===== DECODE TESTS =====

#[test]
fn test_decode_send_to() {
    let expected_send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, _) = OFTMsgCodec::encode(expected_send_to, amount_shared, @compose_msg);
    let decoded_send_to = OFTMsgCodec::send_to(@message);

    assert(decoded_send_to.value == expected_send_to.value, 'Send to should match');
}

#[test]
fn test_decode_amount_sd() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let expected_amount = 1000_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, _) = OFTMsgCodec::encode(send_to, expected_amount, @compose_msg);
    let decoded_amount = OFTMsgCodec::amount_sd(@message);

    assert(decoded_amount == expected_amount, 'Amount should match');
}

#[test]
fn test_decode_send_to_max_value() {
    let expected_send_to = Bytes32 {
        value: 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff,
    };
    let amount_shared = 1000_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, _) = OFTMsgCodec::encode(expected_send_to, amount_shared, @compose_msg);
    let decoded_send_to = OFTMsgCodec::send_to(@message);

    assert(decoded_send_to.value == expected_send_to.value, 'Max send_to should match');
}

// ===== COMPOSE_MSG TESTS =====

#[test]
fn test_compose_msg_simple_message() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, _) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);
    let decoded_compose = OFTMsgCodec::compose_msg(@message);

    assert(decoded_compose.len() == 0, 'Simple msg empty compose');
}

#[test]
fn test_compose_msg_composed_message() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;
    let mut compose_msg: ByteArray = Default::default();
    compose_msg.append_byte(0xaa);
    compose_msg.append_byte(0xbb);
    compose_msg.append_byte(0xcc);

    let (message, _) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);
    let decoded_compose = OFTMsgCodec::compose_msg(@message);

    // Note: composed message includes 32 bytes for sender + original compose content
    assert(decoded_compose.len() > 0, 'Composed msg has content');
}

// ===== COMPOSED_SENDER TESTS =====

#[test]
fn test_composed_sender_simple_message() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;
    let compose_msg: ByteArray = Default::default();

    let (message, _) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);
    let sender = OFTMsgCodec::composed_sender(@message);

    assert(sender.is_none(), 'Simple msg no sender');
}

#[test]
fn test_composed_sender_composed_message() {
    let send_to = Bytes32 { value: 0x123456789abcdef };
    let amount_shared = 1000_u64;
    let mut compose_msg: ByteArray = Default::default();
    compose_msg.append_byte(0x01);

    let (message, _) = OFTMsgCodec::encode(send_to, amount_shared, @compose_msg);
    let sender = OFTMsgCodec::composed_sender(@message);

    assert(sender.is_some(), 'Composed msg has sender');
}

// ===== ADDRESS CONVERSION TESTS =====

#[test]
fn test_address_conversion() {
    let addr: ContractAddress = 0x123456789abcdef.try_into().unwrap();

    let bytes32_result = OFTMsgCodec::address_to_bytes32(addr);
    let addr_result = OFTMsgCodec::bytes32_to_address(bytes32_result);

    assert(addr_result.unwrap() == addr, 'Address conversion failed');
}

#[test]
fn test_address_conversion_zero() {
    let addr: ContractAddress = 0.try_into().unwrap();

    let bytes32_result = OFTMsgCodec::address_to_bytes32(addr);
    let addr_result = OFTMsgCodec::bytes32_to_address(bytes32_result);

    assert(addr_result.unwrap() == addr, 'Zero address conversion failed');
}

#[test]
fn test_bytes32_to_address_zero() {
    let bytes32_zero = Bytes32 { value: 0 };
    let addr_result = OFTMsgCodec::bytes32_to_address(bytes32_zero);

    assert(addr_result.is_some(), 'Zero bytes32 converts');
}

// ===== ROUNDTRIP TESTS =====

#[test]
fn test_roundtrip_encode_decode() {
    let original_send_to = Bytes32 { value: 0xfedcba9876543210fedcba9876543210 };
    let original_amount = 987654321_u64;
    let mut original_compose_msg: ByteArray = Default::default();
    original_compose_msg.append(@"test roundtrip message");

    let (encoded_message, has_compose) = OFTMsgCodec::encode(
        original_send_to, original_amount, @original_compose_msg,
    );

    assert(has_compose, 'Should have compose');

    // Decode and verify
    let decoded_send_to = OFTMsgCodec::send_to(@encoded_message);
    let decoded_amount = OFTMsgCodec::amount_sd(@encoded_message);
    let decoded_compose = OFTMsgCodec::compose_msg(@encoded_message);
    let decoded_sender = OFTMsgCodec::composed_sender(@encoded_message);

    assert(decoded_send_to.value == original_send_to.value, 'RT send_to fail');
    assert(decoded_amount == original_amount, 'RT amount fail');
    assert(decoded_compose.len() > 0, 'RT compose fail');
    assert(decoded_sender.is_some(), 'RT sender fail');
}

#[test]
fn test_roundtrip_simple_message() {
    let original_send_to = Bytes32 { value: 0x1234567890abcdef };
    let original_amount = 42_u64;
    let original_compose_msg: ByteArray = Default::default();

    let (encoded_message, has_compose) = OFTMsgCodec::encode(
        original_send_to, original_amount, @original_compose_msg,
    );

    assert(!has_compose, 'Should not have compose');
    assert(encoded_message.len() == 40, 'Simple msg len wrong');

    // Decode and verify
    let decoded_send_to = OFTMsgCodec::send_to(@encoded_message);
    let decoded_amount = OFTMsgCodec::amount_sd(@encoded_message);
    let decoded_compose = OFTMsgCodec::compose_msg(@encoded_message);
    let decoded_sender = OFTMsgCodec::composed_sender(@encoded_message);

    assert(decoded_send_to.value == original_send_to.value, 'Simple rt send_to fail');
    assert(decoded_amount == original_amount, 'Simple rt amount fail');
    assert(decoded_compose.len() == 0, 'Simple rt compose fail');
    assert(decoded_sender.is_none(), 'Simple rt sender fail');
}
