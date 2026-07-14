use crate::{
    buffer_reader::BufferReader,
    buffer_writer::BufferWriter,
    bytes_ext::BytesExt,
    tests::test_helper::{assert_address_payload_matches, assert_panics_contains},
};
use soroban_sdk::{address_payload::AddressPayload, testutils::Address as _, Address, Bytes, BytesN, Env};

type ReaderStep = fn(&mut BufferReader);

fn assert_reader_panics_contains(case: &str, raw: &[u8], step: ReaderStep, expected_substring: &str) {
    assert_panics_contains(case, expected_substring, || {
        let env = Env::default();
        let bytes = Bytes::from_slice(&env, raw);
        let mut reader = BufferReader::new(&bytes);
        step(&mut reader);
    });
}

/// Helper to test U256 read roundtrip
fn test_u256_read_roundtrip(env: &Env, value: &soroban_sdk::U256) {
    let mut writer = BufferWriter::new(env);
    writer.write_u256(value.clone());
    let bytes = writer.to_bytes();
    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_u256(), *value);
    assert_eq!(reader.remaining_len(), 0);
}

/// Helper to test address roundtrip
fn test_address_roundtrip(env: &Env, address: &Address) {
    let mut writer = BufferWriter::new(env);
    writer.write_address(address);
    let bytes = writer.to_bytes();

    let mut reader = BufferReader::new(&bytes);
    let read_address = reader.read_address();

    assert_eq!(read_address, *address);
    assert_eq!(reader.remaining_len(), 0);
}

// ============================================
// read_primitives tests (u8, u16, u32, u64, u128, i128, u256, bool)
// ============================================

#[test]
fn test_read_primitives_big_endian_golden_bytes() {
    let env = Env::default();
    let bytes = Bytes::from_array(
        &env,
        &[
            0x12, // u8
            0x34, 0x56, // u16
            0x78, 0x9A, 0xBC, 0xDE, // u32
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // u64
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F,
            0x10, // u128
        ],
    );
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.read_u8(), 0x12);
    assert_eq!(reader.read_u16(), 0x3456);
    assert_eq!(reader.read_u32(), 0x789ABCDE);
    assert_eq!(reader.read_u64(), 0x0102030405060708);
    assert_eq!(reader.read_u128(), 0x0102030405060708090a0b0c0d0e0f10);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_primitives_roundtrip() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);
    writer
        .write_u8(0x12)
        .write_u16(0x3456)
        .write_u32(0x789ABCDE)
        .write_u64(0x0102030405060708)
        .write_u128(0x0102030405060708090a0b0c0d0e0f10);

    let bytes = writer.to_bytes();
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.read_u8(), 0x12);
    assert_eq!(reader.read_u16(), 0x3456);
    assert_eq!(reader.read_u32(), 0x789ABCDE);
    assert_eq!(reader.read_u64(), 0x0102030405060708);
    assert_eq!(reader.read_u128(), 0x0102030405060708090a0b0c0d0e0f10);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_i128_roundtrip() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);
    writer.write_i128(0).write_i128(-42).write_i128(123_456_789).write_i128(i128::MIN).write_i128(i128::MAX);

    let bytes = writer.to_bytes();
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.read_i128(), 0);
    assert_eq!(reader.read_i128(), -42);
    assert_eq!(reader.read_i128(), 123_456_789);
    assert_eq!(reader.read_i128(), i128::MIN);
    assert_eq!(reader.read_i128(), i128::MAX);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_i8_i16_i32_i64_i128_big_endian_golden_bytes() {
    let env = Env::default();

    // Layout:
    // - i8:  -1, MIN, MAX                         (3 bytes)
    // - i16: -1, MIN, MAX                         (6 bytes)
    // - i32: -1, MIN, MAX                         (12 bytes)
    // - i64: -1, MIN, MAX                         (24 bytes)
    // - i128: -1, MIN, MAX                        (48 bytes)
    // Total = 93 bytes
    let mut raw = [0u8; 93];
    let mut pos = 0usize;

    raw[pos] = (-1i8) as u8;
    pos += 1;
    raw[pos] = i8::MIN as u8;
    pos += 1;
    raw[pos] = i8::MAX as u8;
    pos += 1;

    raw[pos..pos + 2].copy_from_slice(&(-1i16).to_be_bytes());
    pos += 2;
    raw[pos..pos + 2].copy_from_slice(&i16::MIN.to_be_bytes());
    pos += 2;
    raw[pos..pos + 2].copy_from_slice(&i16::MAX.to_be_bytes());
    pos += 2;

    raw[pos..pos + 4].copy_from_slice(&(-1i32).to_be_bytes());
    pos += 4;
    raw[pos..pos + 4].copy_from_slice(&i32::MIN.to_be_bytes());
    pos += 4;
    raw[pos..pos + 4].copy_from_slice(&i32::MAX.to_be_bytes());
    pos += 4;

    raw[pos..pos + 8].copy_from_slice(&(-1i64).to_be_bytes());
    pos += 8;
    raw[pos..pos + 8].copy_from_slice(&i64::MIN.to_be_bytes());
    pos += 8;
    raw[pos..pos + 8].copy_from_slice(&i64::MAX.to_be_bytes());
    pos += 8;

    raw[pos..pos + 16].copy_from_slice(&[0xFF; 16]); // -1
    pos += 16;
    raw[pos] = 0x80; // i128::MIN (0x80 followed by 15x 0x00)
    pos += 16;
    raw[pos..pos + 16].copy_from_slice(&i128::MAX.to_be_bytes());
    pos += 16;

    assert_eq!(pos, raw.len());

    let bytes = Bytes::from_array(&env, &raw);
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.read_i8(), -1);
    assert_eq!(reader.read_i8(), i8::MIN);
    assert_eq!(reader.read_i8(), i8::MAX);
    assert_eq!(reader.position(), 3);

    assert_eq!(reader.read_i16(), -1);
    assert_eq!(reader.read_i16(), i16::MIN);
    assert_eq!(reader.read_i16(), i16::MAX);
    assert_eq!(reader.position(), 3 + 6);

    assert_eq!(reader.read_i32(), -1);
    assert_eq!(reader.read_i32(), i32::MIN);
    assert_eq!(reader.read_i32(), i32::MAX);
    assert_eq!(reader.position(), 3 + 6 + 12);

    assert_eq!(reader.read_i64(), -1);
    assert_eq!(reader.read_i64(), i64::MIN);
    assert_eq!(reader.read_i64(), i64::MAX);
    assert_eq!(reader.position(), 45);

    assert_eq!(reader.read_i128(), -1);
    assert_eq!(reader.position(), 45 + 16);
    assert_eq!(reader.read_i128(), i128::MIN);
    assert_eq!(reader.position(), 45 + 16 + 16);
    assert_eq!(reader.read_i128(), i128::MAX);
    assert_eq!(reader.position(), 93);

    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_i256_big_endian_golden_bytes() {
    use soroban_sdk::I256;

    let env = Env::default();

    // Layout: -1, MIN, MAX, +1
    let mut raw = [0u8; 32 * 4];
    raw[0..32].copy_from_slice(&[0xFF; 32]); // -1
    raw[32] = 0x80; // MIN (0x80 followed by 31x 0x00)
    raw[64] = 0x7F; // MAX (0x7F followed by 31x 0xFF)
    raw[65..96].copy_from_slice(&[0xFF; 31]);
    raw[127] = 0x01; // +1

    let bytes = Bytes::from_array(&env, &raw);
    let mut reader = BufferReader::new(&bytes);

    let expected_neg1 = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[0..32]));
    let expected_min = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[32..64]));
    let expected_max = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[64..96]));
    let expected_one = I256::from_be_bytes(&env, &Bytes::from_slice(&env, &raw[96..128]));

    assert_eq!(reader.read_i256(), expected_neg1);
    assert_eq!(reader.position(), 32);
    assert_eq!(reader.read_i256(), expected_min);
    assert_eq!(reader.position(), 64);
    assert_eq!(reader.read_i256(), expected_max);
    assert_eq!(reader.position(), 96);
    assert_eq!(reader.read_i256(), expected_one);
    assert_eq!(reader.position(), 128);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_boundary_values() {
    let env = Env::default();
    let mut writer = BufferWriter::new(&env);

    // Write boundary values for each type
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
fn test_read_bool() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x00, 0x01, 0x02, 0x7F, 0x80, 0xFF]);
    let mut reader = BufferReader::new(&bytes);

    assert!(!reader.read_bool()); // 0x00 -> false
    assert!(reader.read_bool()); // 0x01 -> true
    assert!(reader.read_bool()); // 0x02 -> true (any non-zero is true)
    assert!(reader.read_bool()); // 0x7F -> true
    assert!(reader.read_bool()); // 0x80 -> true
    assert!(reader.read_bool()); // 0xFF -> true
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_u256_boundary_values() {
    use soroban_sdk::U256;
    let env = Env::default();

    // Zero
    let zero = U256::from_u32(&env, 0);
    test_u256_read_roundtrip(&env, &zero);

    // From u128::MAX
    let from_u128_max = U256::from_u128(&env, u128::MAX);
    test_u256_read_roundtrip(&env, &from_u128_max);

    // Max (all 0xFF bytes)
    let max_bytes = Bytes::from_array(&env, &[0xFF; 32]);
    let max_u256 = U256::from_be_bytes(&env, &max_bytes);
    test_u256_read_roundtrip(&env, &max_u256);
}

// ============================================
// read_bytes tests (read_bytes, read_bytes_n)
// ============================================

#[test]
fn test_read_bytes_operations() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
    let mut reader = BufferReader::new(&bytes);

    // Read partial
    let chunk1 = reader.read_bytes(3);
    assert_eq!(chunk1.len(), 3);
    assert_eq!(chunk1.get(0).unwrap(), 0x01);
    assert_eq!(chunk1.get(2).unwrap(), 0x03);

    // Read remaining
    let chunk2 = reader.read_bytes_until_end();
    assert_eq!(chunk2.len(), 3);
    assert_eq!(chunk2.get(0).unwrap(), 0x04);
    assert_eq!(chunk2.get(2).unwrap(), 0x06);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_bytes_n() {
    let env = Env::default();
    let bytes = Bytes::from_array(
        &env,
        &[
            0x01, 0x02, 0x03, 0x04, // 4 bytes
            0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, // 8 bytes
            0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21,
            0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f, // 32 bytes
        ],
    );
    let mut reader = BufferReader::new(&bytes);

    let val4: BytesN<4> = reader.read_bytes_n();
    assert_eq!(val4, BytesN::<4>::from_array(&env, &[0x01, 0x02, 0x03, 0x04]));

    let val8: BytesN<8> = reader.read_bytes_n();
    assert_eq!(val8, BytesN::<8>::from_array(&env, &[0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c]));

    let val32: BytesN<32> = reader.read_bytes_n();
    assert_eq!(
        val32,
        BytesN::<32>::from_array(
            &env,
            &[
                0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
                0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c, 0x2d, 0x2e, 0x2f
            ]
        )
    );

    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_array_roundtrip_and_position() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0xAA, 0xBB, 0xCC, 0xDD, 0x10, 0x11]);
    let mut reader = BufferReader::new(&bytes);

    let a4: [u8; 4] = reader.read_array();
    assert_eq!(a4, [0xAA, 0xBB, 0xCC, 0xDD]);
    assert_eq!(reader.position(), 4);
    assert_eq!(reader.remaining_len(), 2);

    let a2: [u8; 2] = reader.read_array();
    assert_eq!(a2, [0x10, 0x11]);
    assert_eq!(reader.position(), 6);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_array_write_array_roundtrip() {
    let env = Env::default();

    let a4: [u8; 4] = [0x01, 0x02, 0x03, 0x04];
    let a1: [u8; 1] = [0xAA];
    let a8: [u8; 8] = [0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17];

    let mut writer = BufferWriter::new(&env);
    writer.write_array(&a4).write_array(&a1).write_array(&a8);

    let bytes = writer.to_bytes();
    assert_eq!(bytes.len(), (a4.len() + a1.len() + a8.len()) as u32);

    let mut reader = BufferReader::new(&bytes);
    let got4: [u8; 4] = reader.read_array();
    assert_eq!(got4, a4);
    assert_eq!(reader.position(), 4);

    let got1: [u8; 1] = reader.read_array();
    assert_eq!(got1, a1);
    assert_eq!(reader.position(), 5);

    let got8: [u8; 8] = reader.read_array();
    assert_eq!(got8, a8);
    assert_eq!(reader.position(), 13);

    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_bytes_zero_length() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    // Read zero bytes should return empty bytes and not advance position
    let chunk = reader.read_bytes(0);
    assert_eq!(chunk.len(), 0);
    assert_eq!(reader.position(), 0);

    // Should be able to read normally after zero-length read
    assert_eq!(reader.read_u8(), 0x01);
}

// ============================================
// read_bytes_until_end tests
// ============================================

#[test]
fn test_read_bytes_until_end_at_start() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    let all_bytes = reader.read_bytes_until_end();
    assert_eq!(all_bytes.len(), 4);
    assert_eq!(all_bytes.get(0).unwrap(), 0x01);
    assert_eq!(all_bytes.get(3).unwrap(), 0x04);
    assert_eq!(reader.remaining_len(), 0);
    assert_eq!(reader.position(), 4);
}

#[test]
fn test_read_bytes_until_end_after_partial_read() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04, 0x05]);
    let mut reader = BufferReader::new(&bytes);

    reader.read_u16(); // Position is now 2
    assert_eq!(reader.position(), 2);
    let remaining = reader.read_bytes_until_end();
    assert_eq!(remaining.len(), 3);
    assert_eq!(remaining.get(0).unwrap(), 0x03);
    assert_eq!(remaining.get(2).unwrap(), 0x05);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_bytes_until_end_when_exhausted() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    // Exhaust buffer by reading all bytes
    reader.read_bytes(4);
    assert_eq!(reader.remaining_len(), 0);

    // read_bytes_until_end on exhausted buffer should return empty Bytes
    let empty = reader.read_bytes_until_end();
    assert_eq!(empty.len(), 0);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_read_bytes_until_end_on_empty_buffer() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[]);
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.remaining_len(), 0);
    let empty = reader.read_bytes_until_end();
    assert_eq!(empty.len(), 0);
    assert_eq!(reader.remaining_len(), 0);
    assert_eq!(reader.position(), 0);
}

// ============================================
// read_address tests
// ============================================

#[test]
fn test_read_address_contract_roundtrip() {
    let env = Env::default();
    let address = Address::generate(&env);
    let payload = address.to_payload().unwrap();
    assert!(matches!(payload, AddressPayload::ContractIdHash(_)));
    test_address_roundtrip(&env, &address);
}

#[test]
fn test_read_address_account_roundtrip() {
    let env = Env::default();
    let account_payload = BytesN::<32>::from_array(
        &env,
        &[
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12,
            0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20,
        ],
    );
    let address = Address::from_payload(&env, AddressPayload::AccountIdPublicKeyEd25519(account_payload));
    let payload = address.to_payload().unwrap();
    assert!(matches!(payload, AddressPayload::AccountIdPublicKeyEd25519(_)));
    test_address_roundtrip(&env, &address);
}

#[test]
fn test_read_address_all_zero_payload() {
    let env = Env::default();
    let zero_payload = BytesN::<32>::from_array(&env, &[0x00; 32]);
    let addr = Address::from_payload(&env, AddressPayload::AccountIdPublicKeyEd25519(zero_payload));
    test_address_roundtrip(&env, &addr);
}

#[test]
fn test_read_address_mixed_types_roundtrip() {
    let env = Env::default();
    let contract_addr = Address::generate(&env);
    let account_payload = BytesN::<32>::from_array(&env, &[0x42; 32]);
    let account_addr = Address::from_payload(&env, AddressPayload::AccountIdPublicKeyEd25519(account_payload));

    let mut writer = BufferWriter::new(&env);
    writer.write_address(&contract_addr).write_address(&account_addr);
    let bytes = writer.to_bytes();

    assert_eq!(bytes.len(), 66); // 33 bytes per address

    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_address(), contract_addr);
    assert_eq!(reader.read_address(), account_addr);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_address_encoding_golden_bytes() {
    let env = Env::default();

    let account_payload = BytesN::<32>::from_array(&env, &[0x42; 32]);
    let contract_payload = BytesN::<32>::from_array(&env, &[0x99; 32]);

    let account_addr = Address::from_payload(&env, AddressPayload::AccountIdPublicKeyEd25519(account_payload.clone()));
    let contract_addr = Address::from_payload(&env, AddressPayload::ContractIdHash(contract_payload.clone()));

    let mut w = BufferWriter::new(&env);
    w.write_address(&account_addr).write_address(&contract_addr);
    let bytes = w.to_bytes();

    // Validate raw encoding: 0/1 type byte + 32-byte payload.
    let raw: [u8; 66] = bytes.to_array();
    assert_eq!(raw[0], crate::buffer_writer::ACCOUNT_PAYLOAD_TYPE);
    assert_eq!(raw[1..33], account_payload.to_array());
    assert_eq!(raw[33], crate::buffer_writer::CONTRACT_PAYLOAD_TYPE);
    assert_eq!(raw[34..66], contract_payload.to_array());

    // Validate reader can decode the raw bytes too.
    let mut r = BufferReader::new(&bytes);
    assert_eq!(r.read_address(), account_addr);
    assert_eq!(r.read_address(), contract_addr);
    assert_eq!(r.remaining_len(), 0);
}

#[test]
fn test_read_address_with_other_data_roundtrip() {
    let env = Env::default();
    let address = Address::generate(&env);

    let mut writer = BufferWriter::new(&env);
    writer.write_u32(0x12345678).write_address(&address).write_u64(0xAABBCCDDEEFF0011);
    let bytes = writer.to_bytes();

    assert_eq!(bytes.len(), 4 + 33 + 8);

    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.read_u32(), 0x12345678);
    assert_eq!(reader.read_address(), address);
    assert_eq!(reader.read_u64(), 0xAABBCCDDEEFF0011);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1001)")]
fn test_read_address_invalid_payload_type() {
    let env = Env::default();
    // Create bytes with invalid payload type (not 0 or 1)
    let mut writer = BufferWriter::new(&env);
    writer.write_u8(0xFF); // Invalid payload type
    writer.write_bytes_n(&BytesN::<32>::from_array(&env, &[0x42; 32]));
    let bytes = writer.to_bytes();

    let mut reader = BufferReader::new(&bytes);
    reader.read_address(); // Should panic with BufferReaderError::InvalidAddressPayload (10001)
}

// ============================================
// read_address_payload tests
// ============================================

#[test]
fn test_read_address_payload() {
    let env = Env::default();
    let address = Address::generate(&env);
    let expected_payload = address.to_payload().unwrap();

    let mut writer = BufferWriter::new(&env);
    writer.write_address_payload(&address);
    let bytes = writer.to_bytes();

    assert_eq!(bytes.len(), 32); // Only payload, no type byte

    let mut reader = BufferReader::new(&bytes);
    let payload = reader.read_address_payload();
    assert_address_payload_matches(payload, expected_payload);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")]
fn test_read_address_payload_insufficient_bytes() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x00; 31]); // Need 32 bytes
    let mut reader = BufferReader::new(&bytes);
    let _payload: BytesN<32> = reader.read_address_payload();
}

// ============================================
// position tests
// ============================================

#[test]
fn test_position_operations() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a]);
    let mut reader = BufferReader::new(&bytes);

    // Test 1: Initial state
    assert_eq!(reader.position(), 0);
    assert_eq!(reader.remaining_len(), 10);
    assert_eq!(reader.len(), 10);
    assert!(!reader.is_empty());

    // Test 2: Read and check position/remaining relationship
    reader.read_u32();
    assert_eq!(reader.position(), 4);
    assert_eq!(reader.remaining_len(), 6);

    // Test 3: Skip operation
    reader.skip(2);
    assert_eq!(reader.position(), 6);
    assert_eq!(reader.remaining_len(), 4);

    // Test 4: Rewind operation
    reader.rewind(3);
    assert_eq!(reader.position(), 3);
    assert_eq!(reader.remaining_len(), 7);

    // Test 5: Set position operation
    reader.seek(5);
    assert_eq!(reader.position(), 5);
    assert_eq!(reader.remaining_len(), 5);

    // Test 6: Set position and read
    reader.seek(1);
    assert_eq!(reader.position(), 1);
    assert_eq!(reader.read_u8(), 0x02);

    // Test 7: Method chaining - skip -> skip -> read
    reader.seek(0);
    let value = reader.skip(2).skip(1).read_u8();
    assert_eq!(value, 0x04);
    assert_eq!(reader.position(), 4);

    // Test 8: Method chaining - rewind -> read
    reader.rewind(2);
    let value = reader.read_u8();
    assert_eq!(value, 0x03);
    assert_eq!(reader.position(), 3);

    // Test 9: Method chaining - seek -> read
    let value = reader.seek(0).read_u8();
    assert_eq!(value, 0x01);
    assert_eq!(reader.position(), 1);
}

// ============================================
// seek tests
// ============================================

#[test]
fn test_seek_boundary_values() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    // Set to start
    reader.seek(0);
    assert_eq!(reader.position(), 0);
    assert_eq!(reader.read_u8(), 0x01);

    // Set to end (exact boundary - should be valid)
    reader.seek(4);
    assert_eq!(reader.position(), 4);
    assert_eq!(reader.remaining_len(), 0);

    // Set to middle
    reader.seek(2);
    assert_eq!(reader.position(), 2);
    assert_eq!(reader.read_u8(), 0x03);
}

#[test]
fn test_seek_on_empty_buffer() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[]);
    let mut reader = BufferReader::new(&bytes);

    // Should be able to set position to 0 on empty buffer
    reader.seek(0);
    assert_eq!(reader.position(), 0);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")]
fn test_seek_beyond_buffer() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);
    reader.seek(5); // Buffer length is 4, position 5 is invalid
}

// ============================================
// skip tests
// ============================================

#[test]
fn test_skip_zero() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    reader.read_u8(); // Position is now 1
    assert_eq!(reader.position(), 1);

    // Skip zero should be no-op
    reader.skip(0);
    assert_eq!(reader.position(), 1);
}

#[test]
fn test_skip_to_exact_end() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    // Skip to exactly the end (boundary case)
    reader.skip(4);
    assert_eq!(reader.position(), 4);
    assert_eq!(reader.remaining_len(), 0);

    // Should be able to read_bytes_until_end without error (returns empty)
    let empty = reader.read_bytes_until_end();
    assert_eq!(empty.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")]
fn test_skip_beyond_buffer() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);
    reader.skip(5);
}

// ============================================
// rewind tests
// ============================================

#[test]
fn test_rewind_zero() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    reader.read_u8(); // Position is now 1
    assert_eq!(reader.position(), 1);

    // Rewind zero should be no-op
    reader.rewind(0);
    assert_eq!(reader.position(), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")]
fn test_rewind_beyond_start() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);
    reader.read_bytes(2);
    reader.rewind(3); // Can only rewind 2
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")]
fn test_rewind_from_start() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03]);
    let mut reader = BufferReader::new(&bytes);
    assert_eq!(reader.position(), 0);
    reader.rewind(1); // Position is 0, can't rewind
}

// ============================================
// buffer_access tests (buffer, env, is_empty, len, remaining)
// ============================================

#[test]
fn test_buffer_access_and_empty_buffer() {
    let env = Env::default();

    // Test 1: Buffer and env access
    let bytes1 = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader1 = BufferReader::new(&bytes1);
    reader1.read_u16();
    let buffer = reader1.buffer();
    assert_eq!(buffer.len(), 4);
    assert_eq!(buffer.get(0).unwrap(), 0x01);
    let _new_bytes = Bytes::from_array(reader1.env(), &[0x03, 0x04]);

    // Test 2: Empty buffer
    let bytes2 = Bytes::from_array(&env, &[]);
    let reader2 = BufferReader::new(&bytes2);
    assert!(reader2.is_empty());
    assert_eq!(reader2.len(), 0);
    assert_eq!(reader2.remaining_len(), 0);
    assert_eq!(reader2.position(), 0);
}

#[test]
fn test_is_empty_semantics() {
    // is_empty() checks if the BUFFER is empty, not if remaining bytes is zero
    let env = Env::default();

    // Non-empty buffer: is_empty should always be false regardless of position
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    assert!(!reader.is_empty());
    reader.read_bytes(4); // Exhaust buffer
    assert_eq!(reader.remaining_len(), 0);
    assert!(!reader.is_empty()); // Buffer itself is NOT empty, just fully read

    // Empty buffer: is_empty should be true
    let empty_bytes = Bytes::from_array(&env, &[]);
    let empty_reader = BufferReader::new(&empty_bytes);
    assert!(empty_reader.is_empty());
}

#[test]
fn test_len_immutable_after_reads() {
    // len() returns total buffer length, should not change after reads
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    let mut reader = BufferReader::new(&bytes);

    assert_eq!(reader.len(), 8);

    reader.read_u32();
    assert_eq!(reader.len(), 8); // Still 8

    reader.skip(2);
    assert_eq!(reader.len(), 8); // Still 8

    reader.read_bytes_until_end();
    assert_eq!(reader.len(), 8); // Still 8
}

// ============================================
// insufficient_bytes_error tests
// ============================================

#[test]
fn test_buffer_reader_invalid_length_panics_table() {
    const EXPECTED: &str = "Error(Contract, #1000)";

    let cases: &[(&str, &[u8], ReaderStep)] = &[
        ("read_array<4> from 3", &[0x01, 0x02, 0x03], |r: &mut BufferReader| {
            let _val: [u8; 4] = r.read_array();
        }),
        ("read_i8 empty", &[], |r: &mut BufferReader| {
            r.read_i8();
        }),
        ("read_i16 1 byte", &[0x01], |r: &mut BufferReader| {
            r.read_i16();
        }),
        ("read_i32 3 bytes", &[0x01, 0x02, 0x03], |r: &mut BufferReader| {
            r.read_i32();
        }),
        ("read_i64 7 bytes", &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07], |r: &mut BufferReader| {
            r.read_i64();
        }),
        ("read_u8 empty", &[], |r: &mut BufferReader| {
            r.read_u8();
        }),
        ("read_u16 1 byte", &[0x01], |r: &mut BufferReader| {
            r.read_u16();
        }),
        ("read_u32 3 bytes", &[0x01, 0x02, 0x03], |r: &mut BufferReader| {
            r.read_u32();
        }),
        ("read_u64 7 bytes", &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07], |r: &mut BufferReader| {
            r.read_u64();
        }),
        ("read_u128 15 bytes", &[0x01; 15], |r: &mut BufferReader| {
            r.read_u128();
        }),
        ("read_i128 15 bytes", &[0x01; 15], |r: &mut BufferReader| {
            r.read_i128();
        }),
        ("read_u256 31 bytes", &[0x01; 31], |r: &mut BufferReader| {
            r.read_u256();
        }),
        ("read_i256 31 bytes", &[0x01; 31], |r: &mut BufferReader| {
            r.read_i256();
        }),
        ("read_bytes(10) from 4", &[0x01, 0x02, 0x03, 0x04], |r: &mut BufferReader| {
            r.read_bytes(10);
        }),
        ("read_bytes_n<4> from 3", &[0x01, 0x02, 0x03], |r: &mut BufferReader| {
            let _val: BytesN<4> = r.read_bytes_n();
        }),
        ("read_address from 32 (needs 33)", &[0x00; 32], |r: &mut BufferReader| {
            r.read_address();
        }),
        ("read_bool empty", &[], |r: &mut BufferReader| {
            r.read_bool();
        }),
    ];

    for (name, raw, step) in cases {
        assert_reader_panics_contains(name, raw, *step, EXPECTED);
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")]
fn test_read_after_buffer_exhausted() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    let _val = reader.read_u32(); // Exhausts the buffer
    assert_eq!(reader.remaining_len(), 0);
    reader.read_u8(); // Should panic
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")]
fn test_read_insufficient_bytes_after_partial_read() {
    let env = Env::default();
    let bytes = Bytes::from_array(&env, &[0x01, 0x02, 0x03, 0x04]);
    let mut reader = BufferReader::new(&bytes);

    // Read 2 bytes successfully
    let _chunk = reader.read_bytes(2);
    assert_eq!(reader.remaining_len(), 2);

    // Try to read 3 bytes when only 2 remain
    // Should panic with InsufficientBytes error
    reader.read_bytes(3);
}
