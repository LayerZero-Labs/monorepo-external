//! DVN options tests

use core::byte_array::ByteArray;
use core::nullable::{FromNullableResult, match_nullable};
use layerzero::workers::dvn::options::{
    DVN_WORKER_ID, OPTION_TYPE_PRECRIME, group_dvn_options_by_idx, next_dvn_option,
};
use layerzero::workers::dvn::structs::DvnOption;
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use crate::workers::dvn::utils::{add_dvn_option, add_dvn_precrime_option};

#[test]
fn test_group_dvn_options_by_idx_empty_options() {
    let options: ByteArray = Default::default();
    let mut grouped_options = group_dvn_options_by_idx(@options);

    // For empty options, the dictionary should be empty (no entries)
    // We can't directly check if a dict is empty, but we can try to get a value
    let (_, value) = grouped_options.entry(0);
    let is_null = match match_nullable(value) {
        FromNullableResult::Null => true,
        FromNullableResult::NotNull(_) => false,
    };
    assert!(is_null, "Expected empty dictionary for empty options");
}

#[test]
fn test_group_dvn_options_by_idx_single_dvn() {
    let mut options: ByteArray = Default::default();
    options = add_dvn_precrime_option(options, 5); // dvn 5

    let mut grouped_options = group_dvn_options_by_idx(@options);

    // Check that DVN 5 has options
    let (_, value) = grouped_options.entry(5);
    let has_value = match match_nullable(value) {
        FromNullableResult::Null => false,
        FromNullableResult::NotNull(_) => true,
    };

    assert!(has_value, "Expected DVN 5 to have options");
}

#[test]
fn test_group_dvn_options_by_idx_multiple_dvns() {
    let mut options: ByteArray = Default::default();
    options = add_dvn_precrime_option(options, 0); // dvn 0

    let mut future_option_data: ByteArray = Default::default();
    future_option_data.append_u8(1);
    options = add_dvn_option(options, 2, 255, future_option_data); // dvn 2
    options = add_dvn_precrime_option(options, 0); // dvn 0 again

    let grouped_options = group_dvn_options_by_idx(@options);

    // Check DVN 0 has combined options
    let (_, value_0) = grouped_options.entry(0);
    let dvn_0_has_value = match match_nullable(value_0) {
        FromNullableResult::Null => false,
        FromNullableResult::NotNull(_) => true,
    };
    assert!(dvn_0_has_value, "Expected DVN 0 to have options");

    let grouped_options = group_dvn_options_by_idx(@options);
    // Check DVN 2 has options
    let (_, value_2) = grouped_options.entry(2);
    let dvn_2_has_value = match match_nullable(value_2) {
        FromNullableResult::Null => false,
        FromNullableResult::NotNull(_) => true,
    };
    assert!(dvn_2_has_value, "Expected DVN 2 to have options");

    let grouped_options = group_dvn_options_by_idx(@options);
    // Check DVN 1 has no options
    let (_, value_1) = grouped_options.entry(1);
    let dvn_1_has_value = match match_nullable(value_1) {
        FromNullableResult::Null => false,
        FromNullableResult::NotNull(_) => true,
    };
    assert!(!dvn_1_has_value, "Expected DVN 1 to have no options");
}

#[test]
fn test_group_dvn_options_by_idx_content_verification() {
    let mut options: ByteArray = Default::default();

    // Add first option for DVN 0 (precrime)
    options = add_dvn_precrime_option(options, 0);

    // Add option for DVN 1 with custom data
    let mut custom_data: ByteArray = Default::default();
    custom_data.append_u8(0xaa);
    custom_data.append_u8(0xbb);
    options = add_dvn_option(options, 1, 42, custom_data);

    // Add second option for DVN 0 (different type with data)
    let mut dvn0_data: ByteArray = Default::default();
    dvn0_data.append_u8(0x11);
    options = add_dvn_option(options, 0, 99, dvn0_data);

    let mut grouped_options = group_dvn_options_by_idx(@options);

    // Verify DVN 0 has combined options (2 options total)
    let (_, value_0) = grouped_options.entry(0);
    let dvn_0_options = match match_nullable(value_0) {
        FromNullableResult::Null => panic!("DVN 0 should have options"),
        FromNullableResult::NotNull(options_box) => options_box.unbox(),
    };

    // DVN 0 should have 2 combined options:
    // First: [DVN_WORKER_ID][3][0][OPTION_TYPE_PRECRIME][0x1] (6 bytes)
    // Second: [DVN_WORKER_ID][3][0][99][0x11] (6 bytes)
    // Total: 12 bytes
    assert!(dvn_0_options.len() == 12, "DVN 0 should have 12 bytes of combined options");

    // Verify first few bytes of DVN 0 options
    let (_, first_worker_id) = dvn_0_options.read_u8(0);
    assert!(first_worker_id == DVN_WORKER_ID, "First option should start with DVN_WORKER_ID");

    let (_, first_option_size) = dvn_0_options.read_u16(1);
    assert!(first_option_size == 3, "First option size should be 3");

    let (_, first_dvn_idx) = dvn_0_options.read_u8(3);
    assert!(first_dvn_idx == 0, "First option DVN index should be 0");

    let (_, first_option_type) = dvn_0_options.read_u8(4);
    assert!(first_option_type == OPTION_TYPE_PRECRIME, "First option type should be precrime");

    let (_, first_option_data) = dvn_0_options.read_u8(5);
    assert!(first_option_data == 0x1, "First option data should be 0x1");

    // Verify second option in DVN 0 (starts at byte 6)
    let (_, second_worker_id) = dvn_0_options.read_u8(6);
    assert!(second_worker_id == DVN_WORKER_ID, "Second option should start with DVN_WORKER_ID");

    let (_, second_option_size) = dvn_0_options.read_u16(7);
    assert!(second_option_size == 3, "Second option size should be 3");

    let (_, second_dvn_idx) = dvn_0_options.read_u8(9);
    assert!(second_dvn_idx == 0, "Second option DVN index should be 0");

    let (_, second_option_type) = dvn_0_options.read_u8(10);
    assert!(second_option_type == 99, "Second option type should be 99");

    let (_, second_option_data) = dvn_0_options.read_u8(11);
    assert!(second_option_data == 0x11, "Second option data should be 0x11");

    // Verify DVN 1 has single option
    grouped_options = group_dvn_options_by_idx(@options);
    let (_, value_1) = grouped_options.entry(1);
    let dvn_1_options = match match_nullable(value_1) {
        FromNullableResult::Null => panic!("DVN 1 should have options"),
        FromNullableResult::NotNull(options_box) => options_box.unbox(),
    };

    // DVN 1 should have 1 option: [DVN_WORKER_ID][4][1][42][0xaa][0xbb] (7 bytes)
    assert!(dvn_1_options.len() == 7, "DVN 1 should have 7 bytes of options");

    let (_, dvn1_worker_id) = dvn_1_options.read_u8(0);
    assert!(dvn1_worker_id == DVN_WORKER_ID, "DVN 1 option should start with DVN_WORKER_ID");

    let (_, dvn1_option_size) = dvn_1_options.read_u16(1);
    assert!(dvn1_option_size == 4, "DVN 1 option size should be 4");

    let (_, dvn1_dvn_idx) = dvn_1_options.read_u8(3);
    assert!(dvn1_dvn_idx == 1, "DVN 1 option DVN index should be 1");

    let (_, dvn1_option_type) = dvn_1_options.read_u8(4);
    assert!(dvn1_option_type == 42, "DVN 1 option type should be 42");

    let (_, dvn1_data1) = dvn_1_options.read_u8(5);
    assert!(dvn1_data1 == 0xaa, "DVN 1 first data byte should be 0xaa");

    let (_, dvn1_data2) = dvn_1_options.read_u8(6);
    assert!(dvn1_data2 == 0xbb, "DVN 1 second data byte should be 0xbb");
}

#[test]
fn test_next_dvn_option_single() {
    let mut options: ByteArray = Default::default();
    options = add_dvn_precrime_option(options, 0); // dvn 0

    let DvnOption {
        dvn_index, option_type, option_data, cursor, ..,
    } = next_dvn_option(@options, 0);
    assert!(dvn_index == 0, "Expected DVN index 0");
    assert!(option_type == OPTION_TYPE_PRECRIME, "Expected precrime option type");
    assert!(option_data.len() == 1, "Expected 1 byte of option data for precrime");
    assert!(cursor == options.len(), "Cursor should be at end of options");
}

#[test]
fn test_next_dvn_option_with_data() {
    let mut options: ByteArray = Default::default();

    // Create option with data
    let mut option_data: ByteArray = Default::default();
    option_data.append_u8(0xaa);
    option_data.append_u8(0xbb);

    options = add_dvn_option(options, 1, 42, option_data);

    let DvnOption {
        dvn_index, option_type, option_data, cursor, ..,
    } = next_dvn_option(@options, 0);

    assert!(dvn_index == 1, "Expected DVN index 1");
    assert!(option_type == 42, "Expected option type 42");
    assert!(option_data.len() == 2, "Expected 2 bytes of option data");

    let (_, byte1) = option_data.read_u8(0);
    let (_, byte2) = option_data.read_u8(1);

    assert!(byte1 == 0xaa, "Expected first byte to be 0xaa");
    assert!(byte2 == 0xbb, "Expected second byte to be 0xbb");
    assert!(cursor == options.len(), "Cursor should be at end of options");
}

#[test]
fn test_next_dvn_option_multiple() {
    let mut options: ByteArray = Default::default();
    options = add_dvn_precrime_option(options, 0); // dvn 0

    let mut future_option_data: ByteArray = Default::default();
    future_option_data.append_u8(1);
    options = add_dvn_option(options, 0, 255, future_option_data); // dvn 0, future option
    options = add_dvn_precrime_option(options, 1); // dvn 1

    let mut cursor = 0;

    // First option
    let DvnOption {
        dvn_index: dvn_index_1,
        option_type: option_type_1,
        option_data: option_data_1,
        cursor: new_cursor_1,
        ..,
    } = next_dvn_option(@options, cursor);

    assert!(dvn_index_1 == 0, "Expected DVN index 0");
    assert!(option_type_1 == OPTION_TYPE_PRECRIME, "Expected precrime option type");
    assert!(option_data_1.len() == 1, "Expected 1 byte of option data for precrime");

    // Update cursor
    cursor = new_cursor_1;

    // Second option
    let DvnOption {
        dvn_index: dvn_index_2,
        option_type: option_type_2,
        option_data: option_data_2,
        cursor: new_cursor_2,
        ..,
    } = next_dvn_option(@options, cursor);

    assert!(dvn_index_2 == 0, "Expected DVN index 0");
    assert!(option_type_2 == 255, "Expected future option type 255");
    assert!(option_data_2.len() == 1, "Expected 1 byte of option data");

    let (_, first_byte) = option_data_2.read_u8(0);
    assert!(first_byte == 1, "Expected option data to be [1]");

    cursor = new_cursor_2;

    // Third option
    let DvnOption {
        dvn_index: dvn_index_3,
        option_type: option_type_3,
        option_data: option_data_3,
        cursor: new_cursor_3,
        ..,
    } = next_dvn_option(@options, cursor);

    assert!(dvn_index_3 == 1, "Expected DVN index 1");
    assert!(option_type_3 == OPTION_TYPE_PRECRIME, "Expected precrime option type");
    assert!(option_data_3.len() == 1, "Expected 1 byte of option data for precrime");
    assert!(new_cursor_3 == options.len(), "Cursor should be at end of options");
}

#[test]
#[fuzzer(runs: 10)]
fn test_next_dvn_option_complex_data(expect_dvn_index: u8, expect_option_type: u8) {
    // Create complex option with multi-byte data
    let mut complex_data: ByteArray = Default::default();
    complex_data.append_u8(0xaa);
    complex_data.append_u8(0xbb);
    complex_data.append_u8(0xcc);
    complex_data.append_u8(0xdd);

    let mut options: ByteArray = Default::default();
    options = add_dvn_option(options, expect_dvn_index, expect_option_type, complex_data);

    let DvnOption {
        dvn_index, option_type, option_data, cursor, ..,
    } = next_dvn_option(@options, 0);

    assert!(dvn_index == expect_dvn_index, "Expected DVN index 1");
    assert!(option_type == expect_option_type, "Expected option type 42");
    assert!(option_data.len() == 4, "Expected 4 bytes of option data");

    let (_, byte1) = option_data.read_u8(0);
    let (_, byte2) = option_data.read_u8(1);
    let (_, byte3) = option_data.read_u8(2);
    let (_, byte4) = option_data.read_u8(3);

    assert!(byte1 == 0xaa, "Expected first byte to be 0xaa");
    assert!(byte2 == 0xbb, "Expected second byte to be 0xbb");
    assert!(byte3 == 0xcc, "Expected third byte to be 0xcc");
    assert!(byte4 == 0xdd, "Expected fourth byte to be 0xdd");

    assert!(cursor == options.len(), "Cursor should be at end of options");
}
