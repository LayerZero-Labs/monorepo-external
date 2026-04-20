use soroban_sdk::{Bytes, Env};

use crate::executor_option;

use super::setup::{
    bytes32, option_header, option_lz_compose, option_lz_receive, option_native_drop, option_ordered_execution,
};

// parse_executor_options

#[test]
fn test_parse_executor_options_aggregates_values() {
    let env = Env::default();
    let receiver = bytes32(&env, 0x11);

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 10, Some(2))); // gas=10, value=2
    options.append(&option_native_drop(&env, 5, &receiver)); // value=5
    options.append(&option_lz_compose(&env, 0, 7, Some(3))); // gas=7, value=3
    options.append(&option_ordered_execution(&env)); // flag only

    let agg = executor_option::parse_executor_options(&env, &options, false, 1_000);
    assert_eq!(agg.total_gas, 17); // 10 + 7
    assert_eq!(agg.total_value, 10); // 2 + 5 + 3
    assert_eq!(agg.num_lz_compose, 1);
    assert_eq!(agg.ordered, true);
}

#[test]
fn test_parse_executor_options_counts_multiple_lz_compose() {
    let env = Env::default();

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 10, None));
    options.append(&option_lz_compose(&env, 0, 7, None));
    options.append(&option_lz_compose(&env, 1, 8, Some(1)));

    let agg = executor_option::parse_executor_options(&env, &options, false, 1_000);
    assert_eq!(agg.num_lz_compose, 2);
    assert_eq!(agg.total_gas, 25); // 10 + 7 + 8
    assert_eq!(agg.total_value, 1); // only compose value
}

#[test]
fn test_parse_executor_options_accumulates_multiple_lz_receive_gas_and_value() {
    let env = Env::default();

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 10, Some(2))); // gas=10, value=2
    options.append(&option_lz_receive(&env, 20, Some(3))); // gas=20, value=3

    let agg = executor_option::parse_executor_options(&env, &options, false, 1_000);
    assert_eq!(agg.total_gas, 30);
    assert_eq!(agg.total_value, 5);
    assert_eq!(agg.num_lz_compose, 0);
    assert_eq!(agg.ordered, false);
}

#[test]
fn test_parse_executor_options_allows_total_value_equal_to_native_cap() {
    let env = Env::default();
    let receiver = bytes32(&env, 0x33);

    // total_value = lzReceive.value(50) + nativeDrop(50) = 100, cap=100 should pass (<=).
    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 1, Some(50)));
    options.append(&option_native_drop(&env, 50, &receiver));

    let agg = executor_option::parse_executor_options(&env, &options, false, 100);
    assert_eq!(agg.total_value, 100);
    assert_eq!(agg.total_gas, 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #8)")] // ExecutorFeeLibError::NoOptions
fn test_parse_executor_options_no_options() {
    let env = Env::default();
    executor_option::parse_executor_options(&env, &Bytes::new(&env), false, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // ExecutorFeeLibError::InvalidLzReceiveOption
fn test_parse_executor_options_rejects_invalid_lz_receive_payload_length() {
    let env = Env::default();
    let mut options = Bytes::new(&env);

    // Bad lzReceive payload (15 bytes instead of 16 or 32). Still wrapped in a valid option header.
    let bad = Bytes::from_slice(&env, &[0u8; 15]);
    options.append(&option_header(&env, message_lib_common::worker_options::EXECUTOR_OPTION_TYPE_LZRECEIVE, bad));

    executor_option::parse_executor_options(&env, &options, false, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // ExecutorFeeLibError::InvalidNativeDropOption
fn test_parse_executor_options_rejects_invalid_native_drop_payload_length() {
    let env = Env::default();
    let mut options = Bytes::new(&env);

    // Need a non-zero lzReceive gas, otherwise we'd fail with ZeroLzReceiveGasProvided first.
    options.append(&option_lz_receive(&env, 1, None));

    // Bad nativeDrop payload (47 bytes instead of 48).
    let bad = Bytes::from_slice(&env, &[0u8; 47]);
    options.append(&option_header(&env, message_lib_common::worker_options::EXECUTOR_OPTION_TYPE_NATIVE_DROP, bad));

    executor_option::parse_executor_options(&env, &options, false, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // ExecutorFeeLibError::InvalidLzComposeOption
fn test_parse_executor_options_rejects_invalid_lz_compose_payload_length() {
    let env = Env::default();
    let mut options = Bytes::new(&env);

    // Need a non-zero lzReceive gas, otherwise we'd fail with ZeroLzReceiveGasProvided first.
    options.append(&option_lz_receive(&env, 1, None));

    // Bad lzCompose payload (17 bytes instead of 18 or 34).
    let bad = Bytes::from_slice(&env, &[0u8; 17]);
    options.append(&option_header(&env, crate::executor_option::EXECUTOR_OPTION_TYPE_LZCOMPOSE, bad));

    executor_option::parse_executor_options(&env, &options, false, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // ExecutorFeeLibError::UnsupportedOptionType
fn test_parse_executor_options_v1_rejects_lz_receive_with_value() {
    let env = Env::default();

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 1, Some(1)));

    executor_option::parse_executor_options(&env, &options, true, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // ExecutorFeeLibError::UnsupportedOptionType
fn test_parse_executor_options_v1_rejects_lz_compose() {
    let env = Env::default();

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 1, None));
    options.append(&option_lz_compose(&env, 0, 1, None));

    executor_option::parse_executor_options(&env, &options, true, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #11)")] // ExecutorFeeLibError::ZeroLzComposeGasProvided
fn test_parse_executor_options_zero_lz_compose_gas() {
    let env = Env::default();

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 1, None));
    options.append(&option_lz_compose(&env, 0, 0, None));

    executor_option::parse_executor_options(&env, &options, false, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #10)")] // ExecutorFeeLibError::UnsupportedOptionType
fn test_parse_executor_options_unknown_option_type() {
    let env = Env::default();

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 1, None));
    options.append(&option_header(&env, 0xFE, Bytes::new(&env)));

    executor_option::parse_executor_options(&env, &options, false, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #7)")] // ExecutorFeeLibError::NativeAmountExceedsCap
fn test_parse_executor_options_native_amount_exceeds_cap() {
    let env = Env::default();
    let receiver = bytes32(&env, 0x22);

    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 1, None));
    options.append(&option_native_drop(&env, 101, &receiver)); // cap=100

    executor_option::parse_executor_options(&env, &options, false, 100);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")] // ExecutorFeeLibError::ZeroLzReceiveGasProvided
fn test_parse_executor_options_zero_lz_receive_gas() {
    let env = Env::default();
    let options = option_ordered_execution(&env);
    executor_option::parse_executor_options(&env, &options, false, 1_000);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")] // ExecutorFeeLibError::ZeroLzReceiveGasProvided
fn test_parse_executor_options_treats_zero_lz_receive_gas_as_missing() {
    let env = Env::default();
    let mut options = Bytes::new(&env);
    options.append(&option_lz_receive(&env, 0, None)); // lzReceive present but gas=0
    executor_option::parse_executor_options(&env, &options, false, 1_000);
}

// next_executor_option

#[test]
fn test_next_executor_option() {
    let env = Env::default();

    // Extract option type and data correctly
    let data = Bytes::from_slice(&env, &[0x01, 0x02]);
    let option = option_header(&env, 1, data.clone()); // type 1
    let mut reader = utils::buffer_reader::BufferReader::new(&option);
    let (option_type, option_data) = executor_option::test::next_executor_option_for_test(&mut reader);
    assert_eq!(option_type, 1);
    assert_eq!(option_data.len(), 2);
    assert_eq!(option_data.get(0).unwrap(), 0x01);
    assert_eq!(option_data.get(1).unwrap(), 0x02);
}

#[test]
#[should_panic(expected = "Error(Contract, #1000)")] // BufferReaderError::InvalidLength (wrapped option_size)
fn test_next_executor_option_rejects_zero_option_size() {
    let env = Env::default();
    use utils::buffer_writer::BufferWriter;

    // [worker_id=1][option_size=0][...]
    let mut w = BufferWriter::new(&env);
    w.write_u8(super::setup::EXECUTOR_WORKER_ID).write_u16(0);
    let raw = w.to_bytes();

    let mut reader = utils::buffer_reader::BufferReader::new(&raw);
    let _ = executor_option::test::next_executor_option_for_test(&mut reader);
}

// next_executor_option (invalid/truncated)

#[test]
#[should_panic(expected = "Error(Contract, #1000)")] // BufferReaderError::InvalidLength
fn test_next_executor_option_rejects_truncated_option_data() {
    let env = Env::default();
    use utils::buffer_writer::BufferWriter;

    // Claims option_size=3 => [option_type (1) + option_data (2)]
    // But we only provide option_type and 1 byte of data => truncated.
    let mut w = BufferWriter::new(&env);
    w.write_u8(super::setup::EXECUTOR_WORKER_ID)
        .write_u16(3)
        .write_u8(0xAA) // option_type
        .write_u8(0x01); // only 1 byte data (should be 2)
    let raw = w.to_bytes();

    let mut reader = utils::buffer_reader::BufferReader::new(&raw);
    let _ = executor_option::test::next_executor_option_for_test(&mut reader);
}

// decode_lz_receive_option

#[test]
fn test_decode_lz_receive_option() {
    let env = Env::default();
    use utils::buffer_writer::BufferWriter;

    // 16 bytes: gas only
    let mut w = BufferWriter::new(&env);
    w.write_u128(1);
    let (gas, value) = executor_option::test::decode_lz_receive_option_for_test(&env, &w.to_bytes());
    assert_eq!(gas, 1);
    assert_eq!(value, 0);

    // 32 bytes: gas + value
    let mut w = BufferWriter::new(&env);
    w.write_u128(1).write_u128(2);
    let (gas, value) = executor_option::test::decode_lz_receive_option_for_test(&env, &w.to_bytes());
    assert_eq!(gas, 1);
    assert_eq!(value, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // ExecutorFeeLibError::InvalidLzReceiveOption
fn test_decode_lz_receive_option_invalid_length_15() {
    let env = Env::default();
    // Invalid length: 15 bytes (not 16 or 32)
    let bad = Bytes::from_slice(&env, &[0u8; 15]);
    let _ = executor_option::test::decode_lz_receive_option_for_test(&env, &bad);
}

#[test]
#[should_panic(expected = "Error(Contract, #5)")] // ExecutorFeeLibError::InvalidLzReceiveOption
fn test_decode_lz_receive_option_invalid_length_33() {
    let env = Env::default();
    // Invalid length: 33 bytes (not 16 or 32)
    let bad = Bytes::from_slice(&env, &[0u8; 33]);
    let _ = executor_option::test::decode_lz_receive_option_for_test(&env, &bad);
}

// decode_native_drop_option

#[test]
fn test_decode_native_drop_option() {
    let env = Env::default();
    use utils::buffer_writer::BufferWriter;

    // 48 bytes: amount + receiver
    let receiver = bytes32(&env, 0x12);
    let mut w = BufferWriter::new(&env);
    w.write_u128(1).write_bytes_n(&receiver);
    let (amount, recv) = executor_option::test::decode_native_drop_option_for_test(&env, &w.to_bytes());
    assert_eq!(amount, 1);
    assert_eq!(recv, receiver);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // ExecutorFeeLibError::InvalidNativeDropOption
fn test_decode_native_drop_option_invalid_length_47() {
    let env = Env::default();
    // Invalid length: 47 bytes (not 48)
    let bad = Bytes::from_slice(&env, &[0u8; 47]);
    let _ = executor_option::test::decode_native_drop_option_for_test(&env, &bad);
}

#[test]
#[should_panic(expected = "Error(Contract, #6)")] // ExecutorFeeLibError::InvalidNativeDropOption
fn test_decode_native_drop_option_invalid_length_49() {
    let env = Env::default();
    // Invalid length: 49 bytes (not 48)
    let bad = Bytes::from_slice(&env, &[0u8; 49]);
    let _ = executor_option::test::decode_native_drop_option_for_test(&env, &bad);
}

// decode_lz_compose_option

#[test]
fn test_decode_lz_compose_option() {
    let env = Env::default();
    use utils::buffer_writer::BufferWriter;

    // 18 bytes: index + gas (no value)
    let mut w = BufferWriter::new(&env);
    w.write_u16(0).write_u128(1);
    let (index, gas, value) = executor_option::test::decode_lz_compose_option_for_test(&env, &w.to_bytes());
    assert_eq!(index, 0);
    assert_eq!(gas, 1);
    assert_eq!(value, 0);

    // 34 bytes: index + gas + value
    let mut w = BufferWriter::new(&env);
    w.write_u16(0).write_u128(1).write_u128(2);
    let (index, gas, value) = executor_option::test::decode_lz_compose_option_for_test(&env, &w.to_bytes());
    assert_eq!(index, 0);
    assert_eq!(gas, 1);
    assert_eq!(value, 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // ExecutorFeeLibError::InvalidLzComposeOption
fn test_decode_lz_compose_option_invalid_length_17() {
    let env = Env::default();
    // Invalid length: 17 bytes (not 18 or 34) - InvalidLzComposeOption
    let bad = Bytes::from_slice(&env, &[0u8; 17]);
    let _ = executor_option::test::decode_lz_compose_option_for_test(&env, &bad);
}

#[test]
#[should_panic(expected = "Error(Contract, #4)")] // ExecutorFeeLibError::InvalidLzComposeOption
fn test_decode_lz_compose_option_invalid_length_35() {
    let env = Env::default();
    // Invalid length: 35 bytes (not 18 or 34) - InvalidLzComposeOption
    let bad = Bytes::from_slice(&env, &[0u8; 35]);
    let _ = executor_option::test::decode_lz_compose_option_for_test(&env, &bad);
}
