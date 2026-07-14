use crate::{
    buffer_reader::BufferReader, buffer_writer::BufferWriter, bytes_ext::BytesExt,
    tests::test_helper::assert_address_payload_matches,
};
use soroban_sdk::{address_payload::AddressPayload, testutils::Address as _, Address, Bytes, BytesN, Env, I256, U256};

/// Helper to test U256 write/read roundtrip
fn test_u256_roundtrip(env: &Env, value: &soroban_sdk::U256) {
    let mut writer = BufferWriter::new(env);
    writer.write_u256(value.clone());
    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 32);

    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_u256(), *value);
    assert_eq!(reader.remaining_len(), 0);
}

/// Helper to test address write/read roundtrip
fn test_address_write_roundtrip(env: &Env, address: &Address) {
    let mut writer = BufferWriter::new(env);
    writer.write_address(address);

    // Address is 33 bytes (1 type + 32 payload)
    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 33);

    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_address(), *address);
    assert_eq!(reader.remaining_len(), 0);
}

// ============================================
// constructor tests (new, from_bytes)
// ============================================

#[test]
fn test_new_buffer_writer() {
    let env = Env::default();
    let writer = BufferWriter::new(&env);

    assert_eq!(writer.len(), 0);
    assert!(writer.is_empty());
}

#[test]
fn test_from_bytes() {
    let env = Env::default();
    let initial = Bytes::from_array(&env, &[0x01, 0x02]);
    let mut writer = BufferWriter::from_bytes(initial);

    writer.write_u8(0x03).write_u16(0x0405);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 5);
    assert_eq!(bytes.get(0).unwrap(), 0x01);
    assert_eq!(bytes.get(1).unwrap(), 0x02);
    assert_eq!(bytes.get(2).unwrap(), 0x03);
    assert_eq!(bytes.get(3).unwrap(), 0x04);
    assert_eq!(bytes.get(4).unwrap(), 0x05);
}

#[test]
fn test_from_bytes_with_large_buffer() {
    let env = Env::default();
    let initial_data: [u8; 100] = core::array::from_fn(|i| i as u8);
    let initial = Bytes::from_array(&env, &initial_data);
    let mut writer = BufferWriter::from_bytes(initial);

    writer.write_u32(0xDEADBEEF);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 104);
    assert_eq!(bytes.get(0).unwrap(), 0);
    assert_eq!(bytes.get(99).unwrap(), 99);
    // Verify appended data
    let mut reader = BufferReader::new(&bytes);
    reader.skip(100);
    assert_eq!(reader.read_u32(), 0xDEADBEEF);
}

#[test]
fn test_from_bytes_empty() {
    let env = Env::default();
    let empty = Bytes::new(&env);
    let mut writer = BufferWriter::from_bytes(empty);

    writer.write_u8(0x42);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 1);
    assert_eq!(bytes.get(0).unwrap(), 0x42);
}

// ============================================
// write_primitives tests (u8, u16, u32, u64, u128, i128, u256, bool)
// ============================================

#[test]
fn test_write_primitives_big_endian_golden_bytes() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);
    writer
        .write_u8(0x12)
        .write_u16(0x3456)
        .write_u32(0x789ABCDE)
        .write_u64(0x0102030405060708)
        .write_u128(0x0102030405060708090a0b0c0d0e0f10);

    let bytes = writer.to_bytes();
    let got: [u8; 31] = bytes.to_array();

    let expected: [u8; 31] = [
        0x12, // u8
        0x34, 0x56, // u16
        0x78, 0x9A, 0xBC, 0xDE, // u32
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // u64
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, // u128
    ];
    assert_eq!(got, expected);
}

#[test]
fn test_write_signed_integers_big_endian_golden_bytes() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    writer
        .write_i8(-1)
        .write_i8(i8::MIN)
        .write_i8(i8::MAX)
        .write_i16(-1)
        .write_i16(i16::MIN)
        .write_i16(i16::MAX)
        .write_i32(-1)
        .write_i32(i32::MIN)
        .write_i32(i32::MAX)
        .write_i64(-1)
        .write_i64(i64::MIN)
        .write_i64(i64::MAX)
        .write_i128(-1)
        .write_i128(i128::MIN)
        .write_i128(i128::MAX);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 93);
    let got: [u8; 93] = bytes.to_array();

    // Layout:
    // - i8:  -1, MIN, MAX                         (3 bytes)
    // - i16: -1, MIN, MAX                         (6 bytes)
    // - i32: -1, MIN, MAX                         (12 bytes)
    // - i64: -1, MIN, MAX                         (24 bytes)
    // - i128: -1, MIN, MAX                        (48 bytes)
    // Total = 93 bytes
    let mut expected = [0u8; 93];
    let mut pos = 0usize;

    expected[pos] = (-1i8) as u8;
    pos += 1;
    expected[pos] = i8::MIN as u8;
    pos += 1;
    expected[pos] = i8::MAX as u8;
    pos += 1;

    expected[pos..pos + 2].copy_from_slice(&(-1i16).to_be_bytes());
    pos += 2;
    expected[pos..pos + 2].copy_from_slice(&i16::MIN.to_be_bytes());
    pos += 2;
    expected[pos..pos + 2].copy_from_slice(&i16::MAX.to_be_bytes());
    pos += 2;

    expected[pos..pos + 4].copy_from_slice(&(-1i32).to_be_bytes());
    pos += 4;
    expected[pos..pos + 4].copy_from_slice(&i32::MIN.to_be_bytes());
    pos += 4;
    expected[pos..pos + 4].copy_from_slice(&i32::MAX.to_be_bytes());
    pos += 4;

    expected[pos..pos + 8].copy_from_slice(&(-1i64).to_be_bytes());
    pos += 8;
    expected[pos..pos + 8].copy_from_slice(&i64::MIN.to_be_bytes());
    pos += 8;
    expected[pos..pos + 8].copy_from_slice(&i64::MAX.to_be_bytes());
    pos += 8;

    expected[pos..pos + 16].copy_from_slice(&(-1i128).to_be_bytes());
    pos += 16;
    expected[pos..pos + 16].copy_from_slice(&i128::MIN.to_be_bytes());
    pos += 16;
    expected[pos..pos + 16].copy_from_slice(&i128::MAX.to_be_bytes());
    pos += 16;

    assert_eq!(pos, expected.len());
    assert_eq!(got, expected);
}

#[test]
fn test_write_signed_integers_roundtrip() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    writer
        .write_i8(0)
        .write_i8(-1)
        .write_i8(i8::MIN)
        .write_i8(i8::MAX)
        .write_i16(0)
        .write_i16(-42)
        .write_i16(i16::MIN)
        .write_i16(i16::MAX)
        .write_i32(0)
        .write_i32(-42)
        .write_i32(i32::MIN)
        .write_i32(i32::MAX)
        .write_i64(0)
        .write_i64(-42)
        .write_i64(i64::MIN)
        .write_i64(i64::MAX)
        .write_i128(0)
        .write_i128(-42)
        .write_i128(123_456_789)
        .write_i128(i128::MIN)
        .write_i128(i128::MAX);

    let bytes = writer.to_bytes();
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.read_i8(), 0);
    assert_eq!(reader.read_i8(), -1);
    assert_eq!(reader.read_i8(), i8::MIN);
    assert_eq!(reader.read_i8(), i8::MAX);

    assert_eq!(reader.read_i16(), 0);
    assert_eq!(reader.read_i16(), -42);
    assert_eq!(reader.read_i16(), i16::MIN);
    assert_eq!(reader.read_i16(), i16::MAX);

    assert_eq!(reader.read_i32(), 0);
    assert_eq!(reader.read_i32(), -42);
    assert_eq!(reader.read_i32(), i32::MIN);
    assert_eq!(reader.read_i32(), i32::MAX);

    assert_eq!(reader.read_i64(), 0);
    assert_eq!(reader.read_i64(), -42);
    assert_eq!(reader.read_i64(), i64::MIN);
    assert_eq!(reader.read_i64(), i64::MAX);

    assert_eq!(reader.read_i128(), 0);
    assert_eq!(reader.read_i128(), -42);
    assert_eq!(reader.read_i128(), 123_456_789);
    assert_eq!(reader.read_i128(), i128::MIN);
    assert_eq!(reader.read_i128(), i128::MAX);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_write_i256_big_endian_golden_bytes_and_roundtrip() {
    let env = Env::default();

    // Golden layouts: -1, MIN, MAX, +1
    let mut raw = [0u8; 32 * 4];
    raw[0..32].copy_from_slice(&[0xFF; 32]); // -1
    raw[32] = 0x80; // MIN (0x80 followed by 31x 0x00)
    raw[64] = 0x7F; // MAX (0x7F followed by 31x 0xFF)
    raw[65..96].copy_from_slice(&[0xFF; 31]);
    raw[127] = 0x01; // +1

    let expected_neg1 = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[0..32]));
    let expected_min = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[32..64]));
    let expected_max = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[64..96]));
    let expected_one = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[96..128]));

    let mut writer = BufferWriter::new(&env);
    writer.write_i256(expected_neg1).write_i256(expected_min).write_i256(expected_max).write_i256(expected_one);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 128);
    let got: [u8; 128] = bytes.to_array();
    assert_eq!(got, raw);

    // Roundtrip through BufferReader.
    let mut reader = BufferReader::new(&bytes);
    let roundtrip_neg1 = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[0..32]));
    let roundtrip_min = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[32..64]));
    let roundtrip_max = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[64..96]));
    let roundtrip_one = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[96..128]));

    assert_eq!(reader.read_i256(), roundtrip_neg1);
    assert_eq!(reader.read_i256(), roundtrip_min);
    assert_eq!(reader.read_i256(), roundtrip_max);
    assert_eq!(reader.read_i256(), roundtrip_one);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_write_primitives_roundtrip() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    writer
        .write_u8(0x12)
        .write_u16(0x3456)
        .write_u32(0x789ABCDE)
        .write_u64(0x0102030405060708)
        .write_u128(0x10111213141516171819_1a1b1c1d1e1f);

    let bytes = writer.to_bytes();
    // 1 + 2 + 4 + 8 + 16 = 31
    assert_eq!(bytes.len(), 31);

    // Verify with reader
    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_u8(), 0x12);
    assert_eq!(reader.read_u16(), 0x3456);
    assert_eq!(reader.read_u32(), 0x789ABCDE);
    assert_eq!(reader.read_u64(), 0x0102030405060708);
    assert_eq!(reader.read_u128(), 0x10111213141516171819_1a1b1c1d1e1f);
}

#[test]
fn test_write_boundary_values() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    writer
        .write_u8(0)
        .write_u8(u8::MAX)
        .write_u16(0)
        .write_u16(u16::MAX)
        .write_u32(0)
        .write_u32(u32::MAX)
        .write_u64(0)
        .write_u64(u64::MAX)
        .write_u128(0)
        .write_u128(u128::MAX);

    let bytes = writer.to_bytes();
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.read_u8(), 0);
    assert_eq!(reader.read_u8(), u8::MAX);
    assert_eq!(reader.read_u16(), 0);
    assert_eq!(reader.read_u16(), u16::MAX);
    assert_eq!(reader.read_u32(), 0);
    assert_eq!(reader.read_u32(), u32::MAX);
    assert_eq!(reader.read_u64(), 0);
    assert_eq!(reader.read_u64(), u64::MAX);
    assert_eq!(reader.read_u128(), 0);
    assert_eq!(reader.read_u128(), u128::MAX);
}

#[test]
fn test_write_bool() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    writer.write_bool(true).write_bool(false).write_bool(true);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 3);

    let mut reader = BufferReader::new(&bytes);
    assert!(reader.read_bool());
    assert!(!reader.read_bool());
    assert!(reader.read_bool());
}

#[test]
fn test_write_u256_boundary_values() {
    use soroban_sdk::U256;
    let env = Env::default();

    // Zero
    let zero = U256::from_u32(&env, 0);
    test_u256_roundtrip(&env, &zero);

    // From u128::MAX
    let from_u128_max = U256::from_u128(&env, u128::MAX);
    test_u256_roundtrip(&env, &from_u128_max);

    // Max (all 0xFF bytes)
    let max_bytes = Bytes::from_array(&env, &[0xFF; 32]);
    let max_u256 = U256::from_be_bytes(&env, &max_bytes);
    test_u256_roundtrip(&env, &max_u256);
}

#[test]
fn test_write_mixed_sizes_no_alignment_issues() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    // Test that byte-packed writes work correctly regardless of "alignment"
    // (Soroban Bytes has no alignment requirements, but this documents the behavior)
    writer
        .write_u8(0x01)
        .write_u64(0x0203040506070809)
        .write_u8(0x0A)
        .write_u128(0x0B0C0D0E0F101112131415161718191A)
        .write_u8(0x1B);

    assert_eq!(writer.len(), 1 + 8 + 1 + 16 + 1); // 27 bytes

    let bytes = writer.to_bytes();
    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_u8(), 0x01);
    assert_eq!(reader.read_u64(), 0x0203040506070809);
    assert_eq!(reader.read_u8(), 0x0A);
    assert_eq!(reader.read_u128(), 0x0B0C0D0E0F101112131415161718191A);
    assert_eq!(reader.read_u8(), 0x1B);
    assert_eq!(reader.remaining_len(), 0);
}

// ============================================
// write_bytes tests (write_bytes, write_bytes_n)
// ============================================

#[test]
fn test_write_bytes() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    let data = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    writer.write_bytes(&data);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 4);
    assert_eq!(bytes.get(0).unwrap(), 0x01);
    assert_eq!(bytes.get(3).unwrap(), 0x04);
}

#[test]
fn test_write_bytes_empty() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    let empty = Bytes::new(&env);
    writer.write_bytes(&empty);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 0);
}

#[test]
fn test_write_bytes_n() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    let bytes4 = BytesN::<4>::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let bytes8 = BytesN::<8>::from_array(&env, &[0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]);
    let bytes32 = BytesN::<32>::from_array(&env, &[0x42; 32]);

    writer.write_bytes_n(&bytes4).write_bytes_n(&bytes8).write_bytes_n(&bytes32);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 4 + 8 + 32);

    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_bytes_n::<4>(), bytes4);
    assert_eq!(reader.read_bytes_n::<8>(), bytes8);
    assert_eq!(reader.read_bytes_n::<32>(), bytes32);
}

#[test]
fn test_write_bytes_n_array() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);
    let bytes = writer.write_array(&[0x01, 0x02, 0x03, 0x04]).to_bytes();
    assert_eq!(bytes.len(), 4);
    assert_eq!(bytes.get(0).unwrap(), 0x01);
    assert_eq!(bytes.get(3).unwrap(), 0x04);
}

// ============================================
// write_address tests
// ============================================

#[test]
fn test_write_address_contract() {
    let env = Env::default();
    let address = Address::generate(&env);
    let payload = address.to_payload().unwrap();
    assert!(matches!(payload, AddressPayload::ContractIdHash(_)));
    test_address_write_roundtrip(&env, &address);
}

#[test]
fn test_write_address_account() {
    let env = Env::default();
    let account_payload = BytesN::<32>::from_array(&env, &[0x42; 32]);
    let address = Address::from_payload(&env, AddressPayload::AccountIdPublicKeyEd25519(account_payload));
    let payload = address.to_payload().unwrap();
    assert!(matches!(payload, AddressPayload::AccountIdPublicKeyEd25519(_)));
    test_address_write_roundtrip(&env, &address);
}

#[test]
fn test_write_multiple_addresses() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);
    let addr3 = Address::generate(&env);

    writer.write_address(&addr1).write_address(&addr2).write_address(&addr3);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 99); // 33 * 3

    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_address(), addr1);
    assert_eq!(reader.read_address(), addr2);
    assert_eq!(reader.read_address(), addr3);
}

// ============================================
// write_address_payload tests
// ============================================

#[test]
fn test_write_address_payload() {
    let env = Env::default();
    let address = Address::generate(&env);
    let expected_payload = address.to_payload().unwrap();

    let mut writer = BufferWriter::new(&env);
    writer.write_address_payload(&address);
    let bytes = writer.to_bytes();

    // Verify it's exactly 32 bytes (no type byte)
    assert_eq!(bytes.len(), 32);

    // Verify the payload matches
    let mut reader = BufferReader::new(&bytes);
    let payload = reader.read_address_payload();
    assert_address_payload_matches(payload, expected_payload);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_write_address_payload_with_other_data() {
    let env = Env::default();
    let address = Address::generate(&env);

    let mut writer = BufferWriter::new(&env);
    writer.write_u32(0x12345678).write_address_payload(&address).write_u64(0xAABBCCDDEEFF0011);
    let bytes = writer.to_bytes();

    assert_eq!(bytes.len(), 4 + 32 + 8); // u32 + payload (32) + u64

    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_u32(), 0x12345678);
    let payload = reader.read_address_payload();
    assert_address_payload_matches(payload, address.to_payload().unwrap());
    assert_eq!(reader.read_u64(), 0xAABBCCDDEEFF0011);
    assert_eq!(reader.remaining_len(), 0);
}

// ============================================
// chaining tests
// ============================================

#[test]
fn test_chaining_empty_bytes() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    let empty = Bytes::new(&env);
    writer.write_bytes(&empty).write_u8(0x42).write_bytes(&empty);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 1); // Only the u8
    assert_eq!(bytes.get(0).unwrap(), 0x42);
}

// ============================================
// buffer_access tests (len, is_empty, env)
// ============================================

#[test]
fn test_len_after_writes() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    assert_eq!(writer.len(), 0);
    assert!(writer.is_empty());

    writer.write_u8(0x01);
    assert_eq!(writer.len(), 1);
    assert!(!writer.is_empty());

    writer.write_u16(0x0203);
    assert_eq!(writer.len(), 3);

    writer.write_u32(0x04050607);
    assert_eq!(writer.len(), 7);
}

#[test]
fn test_env_from_writer() {
    let env = Env::default();
    let writer = BufferWriter::new(&env);

    // Verify we can use the env reference from the writer
    let _new_bytes = Bytes::from_array(writer.env(), &[0x01, 0x02]);
}

// ============================================
// complex_roundtrip tests
// ============================================

#[test]
fn test_complex_message_roundtrip() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    // Simulate a complex message structure
    let version: u8 = 1;
    let msg_type: u16 = 0x0102;
    let sender = Address::generate(&env);
    let nonce: u64 = 12345678;
    let amount = U256::from_u128(&env, 1000000000000000000u128);
    let payload = Bytes::from_array(&env, &[0xDE, 0xAD, 0xBE, 0xEF]);

    writer
        .write_u8(version)
        .write_u16(msg_type)
        .write_address(&sender)
        .write_u64(nonce)
        .write_u256(amount.clone())
        .write_bytes(&payload);

    let bytes = writer.to_bytes();

    // Read back and verify
    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_u8(), version);
    assert_eq!(reader.read_u16(), msg_type);
    assert_eq!(reader.read_address(), sender);
    assert_eq!(reader.read_u64(), nonce);
    assert_eq!(reader.read_u256(), amount);

    let read_payload = reader.read_bytes(4);
    assert_eq!(read_payload.len(), 4);
    assert_eq!(read_payload.get(0).unwrap(), 0xDE);
    assert_eq!(read_payload.get(3).unwrap(), 0xEF);
}

// ============================================
// stress_and_edge_case tests
// ============================================

#[test]
fn test_write_large_buffer() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    // Write many items to test buffer growth
    for i in 0..1000u32 {
        writer.write_u32(i);
    }

    assert_eq!(writer.len(), 4000);

    // Verify via reader
    let bytes = writer.to_bytes();
    let mut reader = BufferReader::new(&bytes);
    for i in 0..1000u32 {
        assert_eq!(reader.read_u32(), i);
    }
}

#[test]
fn test_write_repeated_values() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    for _ in 0..100 {
        writer.write_u8(0xFF);
    }

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), 100);

    for i in 0..100 {
        assert_eq!(bytes.get(i).unwrap(), 0xFF);
    }
}
