//! OFT compose message codec tests

use layerzero::oapps::oft::oft_compose_msg_codec::OFTComposeMsgCodec;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::bytes::Bytes32;
use starknet::ContractAddress;

#[test]
fn test_basic_roundtrip() {
    let nonce = 42_u64;
    let src_eid = 101_u32;
    let amount_ld = 1000_u256;
    let mut compose_msg: ByteArray = Default::default();

    // Add compose_from (32 bytes) + message
    let compose_from = Bytes32 { value: 0x123456789abcdef };
    compose_msg.append_u256(compose_from.value);
    compose_msg.append(@"test message");

    let encoded = OFTComposeMsgCodec::encode(nonce, src_eid, amount_ld, @compose_msg);

    assert(OFTComposeMsgCodec::nonce(@encoded) == nonce, 'Nonce fail');
    assert(OFTComposeMsgCodec::src_eid(@encoded) == src_eid, 'Src EID fail');
    assert(OFTComposeMsgCodec::amount_ld(@encoded) == amount_ld, 'Amount fail');
    assert(OFTComposeMsgCodec::compose_from(@encoded) == compose_from, 'Compose from fail');
    assert(OFTComposeMsgCodec::compose_msg(@encoded) == "test message", 'Compose msg fail');
}

#[test]
fn test_zero_values() {
    let nonce = 0_u64;
    let src_eid = 0_u32;
    let amount_ld = 0_u256;
    let mut compose_msg: ByteArray = Default::default();
    compose_msg.append_u256(0); // zero compose_from

    let encoded = OFTComposeMsgCodec::encode(nonce, src_eid, amount_ld, @compose_msg);

    assert(OFTComposeMsgCodec::nonce(@encoded) == 0, 'Zero nonce fail');
    assert(OFTComposeMsgCodec::src_eid(@encoded) == 0, 'Zero src_eid fail');
    assert(OFTComposeMsgCodec::amount_ld(@encoded) == 0, 'Zero amount fail');
    assert(OFTComposeMsgCodec::compose_from(@encoded).value == 0, 'Zero compose fail');
}

#[test]
fn test_large_values() {
    let nonce = 0xFFFFFFFFFFFFFFFF_u64;
    let src_eid = 0xFFFFFFFF_u32;
    let amount_ld = 0x123456789ABCDEF_u256;
    let mut compose_msg: ByteArray = Default::default();
    compose_msg.append_u256(0x123456789ABCDEF);

    let encoded = OFTComposeMsgCodec::encode(nonce, src_eid, amount_ld, @compose_msg);

    assert(OFTComposeMsgCodec::nonce(@encoded) == nonce, 'Large nonce fail');
    assert(OFTComposeMsgCodec::src_eid(@encoded) == src_eid, 'Large src_eid fail');
    assert(OFTComposeMsgCodec::amount_ld(@encoded) == amount_ld, 'Large amount fail');
}

#[test]
fn test_empty_compose_message() {
    let nonce = 42_u64;
    let src_eid = 101_u32;
    let amount_ld = 1000_u256;
    let compose_msg: ByteArray = Default::default();

    let encoded = OFTComposeMsgCodec::encode(nonce, src_eid, amount_ld, @compose_msg);
    let decoded_compose_msg = OFTComposeMsgCodec::compose_msg(@encoded);

    assert(decoded_compose_msg.len() == 0, 'Empty compose fail');
    assert(encoded.len() == 44, 'Empty length wrong'); // 8+4+32 bytes
}

#[test]
fn test_address_conversion() {
    // Test normal address
    let addr: ContractAddress = 0x123456789abcdef.try_into().unwrap();
    let bytes32_result = OFTComposeMsgCodec::address_to_bytes32(addr);
    let addr_result = OFTComposeMsgCodec::bytes32_to_address(bytes32_result);
    assert(addr_result.unwrap() == addr, 'Address convert fail');

    // Test zero address
    let zero_addr: ContractAddress = 0.try_into().unwrap();
    let zero_bytes32 = OFTComposeMsgCodec::address_to_bytes32(zero_addr);
    let zero_result = OFTComposeMsgCodec::bytes32_to_address(zero_bytes32);
    assert(zero_result.unwrap() == zero_addr, 'Zero addr convert fail');
}

#[test]
fn test_large_compose_message() {
    let nonce = 42_u64;
    let src_eid = 101_u32;
    let amount_ld = 1000_u256;
    let mut compose_msg: ByteArray = Default::default();

    // Add compose_from
    compose_msg.append_u256(0x123456789abcdef);

    // Add large message
    let mut i: u32 = 0;
    while i < 100_u32 {
        compose_msg.append(@"Long message content ");
        i += 1;
    }

    let encoded = OFTComposeMsgCodec::encode(nonce, src_eid, amount_ld, @compose_msg);
    let decoded_compose_msg = OFTComposeMsgCodec::compose_msg(@encoded);

    assert(OFTComposeMsgCodec::nonce(@encoded) == nonce, 'Large msg nonce fail');
    assert(decoded_compose_msg.len() > 2000, 'Large msg too small');
}

#[test]
fn test_message_length_boundaries() {
    let nonce = 42_u64;
    let src_eid = 101_u32;
    let amount_ld = 1000_u256;

    // Test exactly 32 bytes compose_msg (only compose_from)
    let mut compose_msg_32: ByteArray = Default::default();
    compose_msg_32.append_u256(0x123456789abcdef);

    let encoded_32 = OFTComposeMsgCodec::encode(nonce, src_eid, amount_ld, @compose_msg_32);
    assert(encoded_32.len() == 76, 'Length 76 fail'); // 44 + 32

    let decoded_msg_32 = OFTComposeMsgCodec::compose_msg(@encoded_32);
    assert(decoded_msg_32.len() == 0, 'Boundary empty fail');

    // Test 33 bytes compose_msg (compose_from + 1 byte)
    let mut compose_msg_33: ByteArray = Default::default();
    compose_msg_33.append_u256(0x123456789abcdef);
    compose_msg_33.append_u8(0x42);

    let encoded_33 = OFTComposeMsgCodec::encode(nonce, src_eid, amount_ld, @compose_msg_33);
    let decoded_msg_33 = OFTComposeMsgCodec::compose_msg(@encoded_33);
    assert(decoded_msg_33.len() == 1, 'Boundary+1 fail');
}
