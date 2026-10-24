use crate::worker_options::*;
use hex_literal::hex;
use soroban_sdk::{Bytes, BytesN, Env};
use utils::buffer_reader::BufferReader;

#[test]
fn test_convert_legacy_options_type2_outputs_lz_receive_and_native_drop() {
    let env = Env::default();

    // Legacy type 2: gas(u256) + amount(u256) + receiver(20 bytes)
    // gas: 200000 (0x30d40), amount: 10000000 (0x989680)
    let legacy_options = Bytes::from_slice(
        &env,
        &hex!(
            "0000000000000000000000000000000000000000000000000000000000030d40\
             0000000000000000000000000000000000000000000000000000000000989680\
             f39fd6e51aad88f6f4ce6ab8827279cfffb92266"
        ),
    );
    let expected_executor_options = Bytes::from_slice(&env, &hex!("0100110100000000000000000000000000030d400100310200000000000000000000000000989680000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266"));

    let executor_options = convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);

    assert_eq!(executor_options, expected_executor_options);

    let mut reader = BufferReader::new(&executor_options);
    // lzReceive
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID);
    assert_eq!(reader.read_u16(), 17);
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE);
    assert_eq!(reader.read_u128(), 200000);
    // nativeDrop
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID);
    assert_eq!(reader.read_u16(), 49);
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_NATIVE_DROP);
    assert_eq!(reader.read_u128(), 10000000);
    assert_eq!(
        reader.read_bytes_n(),
        BytesN::from_array(&env, &hex!("000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266"))
    );
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_convert_legacy_options_type1_outputs_lz_receive() {
    let env = Env::default();

    // Legacy type 1: gas(u256)
    // gas: 200000 (0x30d40)
    let legacy_options =
        Bytes::from_slice(&env, &hex!("0000000000000000000000000000000000000000000000000000000000030d40"));
    let expected_executor_options = Bytes::from_slice(&env, &hex!("0100110100000000000000000000000000030d40"));

    let executor_options = convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_1);

    assert_eq!(executor_options, expected_executor_options);

    let mut reader = BufferReader::new(&executor_options);
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 17); // option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE); // option_type
    assert_eq!(reader.read_u128(), 200000); // option_data
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_convert_legacy_options_type2_receiver_len_1_is_left_padded_to_bytes32() {
    let env = Env::default();

    // Legacy type 2: gas(u256) + amount(u256) + receiver(1 byte)
    // gas: 200000 (0x30d40), amount: 10000000 (0x989680), receiver: 0x42
    let legacy_options = Bytes::from_slice(
        &env,
        &hex!(
            "0000000000000000000000000000000000000000000000000000000000030d40\
             0000000000000000000000000000000000000000000000000000000000989680\
             42"
        ),
    );

    let executor_options = convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);

    let mut reader = BufferReader::new(&executor_options);
    // lzReceive
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 17); // option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE); // option_type
    assert_eq!(reader.read_u128(), 200000); // option_data
                                            // nativeDrop
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID); // worker_id
    assert_eq!(reader.read_u16(), 49); // option_size
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_NATIVE_DROP); // option_type
    assert_eq!(reader.read_u128(), 10000000); // option_data
    assert_eq!(
        reader.read_bytes_n(),
        BytesN::from_array(&env, &hex!("0000000000000000000000000000000000000000000000000000000000000042"))
    ); // option value (receiver)
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_convert_legacy_options_type2_receiver_len_32_is_not_modified() {
    let env = Env::default();

    // Legacy type 2: gas(u256) + amount(u256) + receiver(32 bytes)
    let legacy_options = Bytes::from_slice(
        &env,
        &hex!(
            "0000000000000000000000000000000000000000000000000000000000030d40\
             0000000000000000000000000000000000000000000000000000000000989680\
             1111111111111111111111111111111111111111111111111111111111111111"
        ),
    );

    let executor_options = convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);

    let mut reader = BufferReader::new(&executor_options);
    // lzReceive
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID);
    assert_eq!(reader.read_u16(), 17);
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE);
    assert_eq!(reader.read_u128(), 200000);
    // nativeDrop
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID);
    assert_eq!(reader.read_u16(), 49);
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_NATIVE_DROP);
    assert_eq!(reader.read_u128(), 10000000);
    assert_eq!(reader.read_bytes_n(), BytesN::from_array(&env, &[0x11u8; 32]));
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_convert_legacy_options_type1_allows_u128_max_gas() {
    let env = Env::default();

    // gas(u256) where value == u128::MAX (fits, should not overflow)
    // u256 big-endian: 16 bytes zeros + 16 bytes 0xff
    let legacy_options =
        Bytes::from_slice(&env, &hex!("00000000000000000000000000000000ffffffffffffffffffffffffffffffff"));

    let executor_options = convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_1);

    let expected_executor_options = Bytes::from_slice(&env, &hex!("01001101ffffffffffffffffffffffffffffffff"));
    assert_eq!(executor_options, expected_executor_options);

    let mut reader = BufferReader::new(&executor_options);
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID);
    assert_eq!(reader.read_u16(), 17);
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE);
    assert_eq!(reader.read_u128(), u128::MAX);
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
fn test_convert_legacy_options_type2_allows_u128_max_gas_and_amount() {
    let env = Env::default();

    // gas(u256)=u128::MAX, amount(u256)=u128::MAX, receiver(32 bytes)=0x11...
    let legacy_options = Bytes::from_slice(
        &env,
        &hex!(
            "00000000000000000000000000000000ffffffffffffffffffffffffffffffff\
             00000000000000000000000000000000ffffffffffffffffffffffffffffffff\
             1111111111111111111111111111111111111111111111111111111111111111"
        ),
    );

    let executor_options = convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);

    let mut reader = BufferReader::new(&executor_options);
    // lzReceive
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID);
    assert_eq!(reader.read_u16(), 17);
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_LZRECEIVE);
    assert_eq!(reader.read_u128(), u128::MAX);
    // nativeDrop
    assert_eq!(reader.read_u8(), EXECUTOR_WORKER_ID);
    assert_eq!(reader.read_u16(), 49);
    assert_eq!(reader.read_u8(), EXECUTOR_OPTION_TYPE_NATIVE_DROP);
    assert_eq!(reader.read_u128(), u128::MAX);
    assert_eq!(reader.read_bytes_n(), BytesN::from_array(&env, &[0x11u8; 32]));
    assert_eq!(reader.remaining_len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #1116)")] // WorkerOptionsError::LegacyOptionsType1GasOverflow
fn test_convert_legacy_options_type1_rejects_gas_overflow() {
    let env = Env::default();
    // Minimal overflow value: u128::MAX + 1 == 2^128
    // u256 big-endian: 16 bytes zeros + 0x01 + 15 bytes zeros + 16 bytes zeros
    let legacy_options =
        Bytes::from_slice(&env, &hex!("0000000000000000000000000000000100000000000000000000000000000000"));
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_1);
}

#[test]
#[should_panic(expected = "Error(Contract, #1118)")] // WorkerOptionsError::LegacyOptionsType2GasOverflow
fn test_convert_legacy_options_type2_rejects_gas_overflow() {
    let env = Env::default();
    let legacy_options = Bytes::from_slice(
        &env,
        &hex!(
            "0000000000000000000000000000000100000000000000000000000000000000\
             00000000000000000000000000000000000000000000000000000000000003e8\
             4242424242424242424242424242424242424242"
        ),
    );
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);
}

#[test]
#[should_panic(expected = "Error(Contract, #1117)")] // WorkerOptionsError::LegacyOptionsType2AmountOverflow
fn test_convert_legacy_options_type2_rejects_amount_overflow() {
    let env = Env::default();
    let legacy_options = Bytes::from_slice(
        &env,
        &hex!(
            "0000000000000000000000000000000000000000000000000000000000030d40\
             0000000000000000000000000000000100000000000000000000000000000000\
             4242424242424242424242424242424242424242"
        ),
    );
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);
}

#[test]
#[should_panic(expected = "Error(Contract, #1112)")] // WorkerOptionsError::InvalidLegacyOptionsType2
fn test_convert_legacy_options_type2_rejects_receiver_longer_than_32_bytes() {
    let env = Env::default();

    // gas(u256) + amount(u256) + receiver(33 bytes)
    let mut bytes = [0u8; 32 + 32 + 33];
    bytes[31] = 1; // gas = 1
    bytes[63] = 1; // amount = 1
    bytes[64..].fill(0x42); // receiver bytes

    let legacy_options = Bytes::from_slice(&env, &bytes);
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);
}

#[test]
#[should_panic(expected = "Error(Contract, #1113)")] // WorkerOptionsError::InvalidOptionType
fn test_convert_legacy_options_rejects_unknown_legacy_type() {
    let env = Env::default();
    let legacy_options = Bytes::from_slice(&env, &[0u8; 32]);
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), 99);
}

#[test]
#[should_panic(expected = "Error(Contract, #1111)")] // WorkerOptionsError::InvalidLegacyOptionsType1
fn test_convert_legacy_options_type1_rejects_invalid_size_too_short() {
    let env = Env::default();
    let legacy_options = Bytes::from_slice(&env, &[0u8; 31]); // 31 bytes
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_1);
}

#[test]
#[should_panic(expected = "Error(Contract, #1111)")] // WorkerOptionsError::InvalidLegacyOptionsType1
fn test_convert_legacy_options_type1_rejects_invalid_size_too_long() {
    let env = Env::default();
    let legacy_options = Bytes::from_slice(&env, &[0u8; 33]); // 33 bytes
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_1);
}

#[test]
#[should_panic(expected = "Error(Contract, #1112)")] // WorkerOptionsError::InvalidLegacyOptionsType2
fn test_convert_legacy_options_type2_rejects_invalid_size_too_short() {
    let env = Env::default();
    // 64 bytes (no receiver)
    let legacy_options = Bytes::from_slice(&env, &[0u8; 64]); // 64 bytes
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);
}

#[test]
#[should_panic(expected = "Error(Contract, #1112)")] // WorkerOptionsError::InvalidLegacyOptionsType2
fn test_convert_legacy_options_type2_rejects_invalid_size_too_long() {
    let env = Env::default();
    let legacy_options = Bytes::from_slice(&env, &[0u8; 97]); // 97 bytes
    convert_legacy_options(&env, &mut BufferReader::new(&legacy_options), LEGACY_OPTIONS_TYPE_2);
}
