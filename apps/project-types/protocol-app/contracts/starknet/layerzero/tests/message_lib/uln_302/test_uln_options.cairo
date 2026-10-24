//! ULN options tests

use core::byte_array::{ByteArray, ByteArrayTrait};
use layerzero::message_lib::uln_302::options::{TYPE_3, split_options};
use layerzero::workers::dvn::options::DVN_WORKER_ID;
use layerzero::workers::executor::options::EXECUTOR_WORKER_ID;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;

// Test error messages as constants (shortened to fit in felt252)
const EXEC_EMPTY: felt252 = 'exec_options empty';
const DVN_EMPTY: felt252 = 'dvn_options empty';
const EXEC_NOT_EMPTY: felt252 = 'exec_options not empty';
const DVN_NOT_EMPTY: felt252 = 'dvn_options not empty';
const WRONG_EXEC_ID: felt252 = 'wrong exec worker id';
const WRONG_DVN_ID: felt252 = 'wrong dvn worker id';
const WRONG_EXEC_SIZE: felt252 = 'wrong exec option size';
const WRONG_DVN_SIZE: felt252 = 'wrong dvn option size';
const WRONG_EXEC_DATA: felt252 = 'wrong exec option data';
const WRONG_DVN_DATA: felt252 = 'wrong dvn option data';
const WRONG_FIRST_EXEC_ID: felt252 = 'wrong first exec id';
const WRONG_SECOND_EXEC_ID: felt252 = 'wrong second exec id';
const WRONG_FIRST_EXEC_SIZE: felt252 = 'wrong first exec size';
const WRONG_SECOND_EXEC_SIZE: felt252 = 'wrong second exec size';
const WRONG_FIRST_EXEC_DATA: felt252 = 'wrong first exec data';
const WRONG_SECOND_EXEC_DATA: felt252 = 'wrong second exec data';
const WRONG_FIRST_DVN_ID: felt252 = 'wrong first dvn id';
const WRONG_SECOND_DVN_ID: felt252 = 'wrong second dvn id';
const WRONG_FIRST_DVN_SIZE: felt252 = 'wrong first dvn size';
const WRONG_SECOND_DVN_SIZE: felt252 = 'wrong second dvn size';

/// Helper function to create a basic Type 3 options ByteArray
fn create_type3_options() -> ByteArray {
    let mut options: ByteArray = Default::default();
    options.append_u16(TYPE_3); // Option type
    options
}

/// Helper function to add a worker option to existing options
fn add_worker_option(ref options: ByteArray, worker_id: u8, option_data: @ByteArray) {
    options.append_u8(worker_id);
    options.append_u16(option_data.len().try_into().unwrap());
    options.append(option_data);
}

/// Helper function to create sample option data
fn create_sample_option_data(size: usize) -> ByteArray {
    let mut data: ByteArray = Default::default();
    let mut i = 0;
    while i != size.try_into().unwrap() {
        data.append_u8(i);
        i += 1;
    }
    data
}

#[test]
fn test_decode_empty_options() {
    let mut options = create_type3_options();
    let (executor_options, dvn_options) = split_options(@options);

    assert(executor_options.len() == 0, EXEC_EMPTY);
    assert(dvn_options.len() == 0, DVN_EMPTY);
}

#[test]
fn test_decode_single_executor_option() {
    let mut options = create_type3_options();
    let sample_data = create_sample_option_data(10);
    add_worker_option(ref options, EXECUTOR_WORKER_ID, @sample_data);

    let (executor_options, dvn_options) = split_options(@options);

    // Check executor options
    assert(executor_options.len() > 0, EXEC_NOT_EMPTY);
    let (cursor, worker_id) = executor_options.read_u8(0);
    assert(worker_id == EXECUTOR_WORKER_ID, WRONG_EXEC_ID);

    let (cursor, option_size) = executor_options.read_u16(cursor);
    assert(option_size == 10, WRONG_EXEC_SIZE);

    let (_, option_data) = executor_options.read_bytes(cursor, 10);
    assert(option_data == sample_data, WRONG_EXEC_DATA);

    // Check DVN options are empty
    assert(dvn_options.len() == 0, DVN_EMPTY);
}

#[test]
fn test_decode_single_dvn_option() {
    let mut options = create_type3_options();
    let sample_data = create_sample_option_data(15);
    add_worker_option(ref options, DVN_WORKER_ID, @sample_data);

    let (executor_options, dvn_options) = split_options(@options);

    // Check executor options are empty
    assert(executor_options.len() == 0, EXEC_EMPTY);

    // Check DVN options
    assert(dvn_options.len() > 0, DVN_NOT_EMPTY);
    let (cursor, worker_id) = dvn_options.read_u8(0);
    assert(worker_id == DVN_WORKER_ID, WRONG_DVN_ID);

    let (cursor, option_size) = dvn_options.read_u16(cursor);
    assert(option_size == 15, WRONG_DVN_SIZE);

    let (_, option_data) = dvn_options.read_bytes(cursor, 15);
    assert(option_data == sample_data, WRONG_DVN_DATA);
}

#[test]
fn test_decode_multiple_executor_options() {
    let mut options = create_type3_options();
    let sample_data1 = create_sample_option_data(5);
    let sample_data2 = create_sample_option_data(8);

    add_worker_option(ref options, EXECUTOR_WORKER_ID, @sample_data1);
    add_worker_option(ref options, EXECUTOR_WORKER_ID, @sample_data2);

    let (executor_options, dvn_options) = split_options(@options);

    // Check executor options contain both entries
    assert(executor_options.len() > 0, EXEC_NOT_EMPTY);

    // First option
    let (cursor, worker_id1) = executor_options.read_u8(0);
    assert(worker_id1 == EXECUTOR_WORKER_ID, WRONG_FIRST_EXEC_ID);

    let (cursor, option_size1) = executor_options.read_u16(cursor);
    assert(option_size1 == 5, WRONG_FIRST_EXEC_SIZE);

    let (cursor, option_data1) = executor_options.read_bytes(cursor, 5);
    assert(option_data1 == sample_data1, WRONG_FIRST_EXEC_DATA);

    // Second option
    let (cursor, worker_id2) = executor_options.read_u8(cursor);
    assert(worker_id2 == EXECUTOR_WORKER_ID, WRONG_SECOND_EXEC_ID);

    let (cursor, option_size2) = executor_options.read_u16(cursor);
    assert(option_size2 == 8, WRONG_SECOND_EXEC_SIZE);

    let (_, option_data2) = executor_options.read_bytes(cursor, 8);
    assert(option_data2 == sample_data2, WRONG_SECOND_EXEC_DATA);

    // Check DVN options are empty
    assert(dvn_options.len() == 0, DVN_EMPTY);
}

#[test]
fn test_decode_mixed_executor_and_dvn_options() {
    let mut options = create_type3_options();
    let executor_data = create_sample_option_data(12);
    let dvn_data = create_sample_option_data(7);

    add_worker_option(ref options, EXECUTOR_WORKER_ID, @executor_data);
    add_worker_option(ref options, DVN_WORKER_ID, @dvn_data);

    let (executor_options, dvn_options) = split_options(@options);

    // Check executor options
    assert(executor_options.len() > 0, EXEC_NOT_EMPTY);
    let (cursor, executor_worker_id) = executor_options.read_u8(0);
    assert(executor_worker_id == EXECUTOR_WORKER_ID, WRONG_EXEC_ID);

    let (cursor, executor_option_size) = executor_options.read_u16(cursor);
    assert(executor_option_size == 12, WRONG_EXEC_SIZE);

    let (_, executor_option_data) = executor_options.read_bytes(cursor, 12);
    assert(executor_option_data == executor_data, WRONG_EXEC_DATA);

    // Check DVN options
    assert(dvn_options.len() > 0, DVN_NOT_EMPTY);
    let (cursor, dvn_worker_id) = dvn_options.read_u8(0);
    assert(dvn_worker_id == DVN_WORKER_ID, WRONG_DVN_ID);

    let (cursor, dvn_option_size) = dvn_options.read_u16(cursor);
    assert(dvn_option_size == 7, WRONG_DVN_SIZE);

    let (_, dvn_option_data) = dvn_options.read_bytes(cursor, 7);
    assert(dvn_option_data == dvn_data, WRONG_DVN_DATA);
}

#[test]
#[should_panic(expected: "INVALID_WORKER_OPTIONS")]
fn test_decode_options_too_short() {
    let mut options: ByteArray = Default::default();
    options.append_u8(1); // Only 1 byte, need at least 2
    split_options(@options);
}

#[test]
#[should_panic(expected: "UNSUPPORTED_OPTION_TYPE")]
fn test_decode_unsupported_option_type() {
    let mut options: ByteArray = Default::default();
    options.append_u16(1); // Type 1 is not supported
    split_options(@options);
}

#[test]
#[should_panic(expected: "INVALID_WORKER_ID")]
fn test_decode_zero_worker_id() {
    let mut options = create_type3_options();
    let sample_data = create_sample_option_data(5);
    add_worker_option(ref options, 0, @sample_data); // Worker ID 0 is invalid
    split_options(@options);
}

#[test]
#[should_panic(expected: "INVALID_WORKER_ID")]
fn test_decode_invalid_worker_id() {
    let mut options = create_type3_options();
    let sample_data = create_sample_option_data(5);
    add_worker_option(ref options, 99, @sample_data); // Invalid worker ID
    split_options(@options);
}

#[test]
#[should_panic(expected: "INVALID_WORKER_OPTIONS")]
fn test_decode_zero_option_size() {
    let mut options = create_type3_options();
    options.append_u8(EXECUTOR_WORKER_ID); // Valid worker ID
    options.append_u16(0); // Invalid option size (0)
    split_options(@options);
}

#[test]
#[should_panic]
fn test_decode_truncated_option_data() {
    let mut options = create_type3_options();
    options.append_u8(EXECUTOR_WORKER_ID); // Valid worker ID
    options.append_u16(10); // Claims 10 bytes of data
    options.append_u8(1); // But only provides 1 byte
    split_options(@options);
}

#[test]
fn test_decode_minimum_valid_option() {
    let mut options = create_type3_options();
    let sample_data = create_sample_option_data(1); // Minimum 1 byte of data
    add_worker_option(ref options, EXECUTOR_WORKER_ID, @sample_data);

    let (executor_options, dvn_options) = split_options(@options);

    assert(executor_options.len() > 0, EXEC_NOT_EMPTY);
    assert(dvn_options.len() == 0, DVN_EMPTY);

    let (cursor, worker_id) = executor_options.read_u8(0);
    assert(worker_id == EXECUTOR_WORKER_ID, WRONG_EXEC_ID);

    let (_, option_size) = executor_options.read_u16(cursor);
    assert(option_size == 1, WRONG_EXEC_SIZE);
}

#[test]
fn test_decode_large_option_data() {
    let mut options = create_type3_options();
    let sample_data = create_sample_option_data(255); // Large option data
    add_worker_option(ref options, DVN_WORKER_ID, @sample_data);

    let (executor_options, dvn_options) = split_options(@options);

    assert(executor_options.len() == 0, EXEC_EMPTY);
    assert(dvn_options.len() > 0, DVN_NOT_EMPTY);

    let (cursor, worker_id) = dvn_options.read_u8(0);
    assert(worker_id == DVN_WORKER_ID, WRONG_DVN_ID);

    let (cursor, option_size) = dvn_options.read_u16(cursor);
    assert(option_size == 255, WRONG_DVN_SIZE);

    let (_, option_data) = dvn_options.read_bytes(cursor, 255);
    assert(option_data == sample_data, WRONG_DVN_DATA);
}

#[test]
fn test_decode_complex_mixed_scenario() {
    let mut options = create_type3_options();

    // Add multiple different options
    let executor_data1 = create_sample_option_data(3);
    let dvn_data1 = create_sample_option_data(6);
    let executor_data2 = create_sample_option_data(9);
    let dvn_data2 = create_sample_option_data(12);

    add_worker_option(ref options, EXECUTOR_WORKER_ID, @executor_data1);
    add_worker_option(ref options, DVN_WORKER_ID, @dvn_data1);
    add_worker_option(ref options, EXECUTOR_WORKER_ID, @executor_data2);
    add_worker_option(ref options, DVN_WORKER_ID, @dvn_data2);

    let (executor_options, dvn_options) = split_options(@options);

    // Verify executor options contain both executor entries
    assert(executor_options.len() > 0, EXEC_NOT_EMPTY);

    // First executor option
    let (cursor, worker_id1) = executor_options.read_u8(0);
    assert(worker_id1 == EXECUTOR_WORKER_ID, WRONG_FIRST_EXEC_ID);
    let (cursor, option_size1) = executor_options.read_u16(cursor);
    assert(option_size1 == 3, WRONG_FIRST_EXEC_SIZE);
    let (cursor, _) = executor_options.read_bytes(cursor, 3);

    // Second executor option
    let (cursor, worker_id2) = executor_options.read_u8(cursor);
    assert(worker_id2 == EXECUTOR_WORKER_ID, WRONG_SECOND_EXEC_ID);
    let (_, option_size2) = executor_options.read_u16(cursor);
    assert(option_size2 == 9, WRONG_SECOND_EXEC_SIZE);

    // Verify DVN options contain both DVN entries
    assert(dvn_options.len() > 0, DVN_NOT_EMPTY);

    // First DVN option
    let (cursor, dvn_worker_id1) = dvn_options.read_u8(0);
    assert(dvn_worker_id1 == DVN_WORKER_ID, WRONG_FIRST_DVN_ID);
    let (cursor, dvn_option_size1) = dvn_options.read_u16(cursor);
    assert(dvn_option_size1 == 6, WRONG_FIRST_DVN_SIZE);
    let (cursor, _) = dvn_options.read_bytes(cursor, 6);

    // Second DVN option
    let (cursor, dvn_worker_id2) = dvn_options.read_u8(cursor);
    assert(dvn_worker_id2 == DVN_WORKER_ID, WRONG_SECOND_DVN_ID);
    let (_, dvn_option_size2) = dvn_options.read_u16(cursor);
    assert(dvn_option_size2 == 12, WRONG_SECOND_DVN_SIZE);
}
