//! DVN options

use core::byte_array::ByteArray;
use core::dict::{Felt252Dict, Felt252DictEntryTrait};
use core::nullable::{FromNullableResult, NullableTrait, match_nullable};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::error::assert_with_byte_array;
use crate::workers::dvn::errors::err_invalid_dvn_options;
use crate::workers::dvn::structs::DvnOption;

// Constants
pub const DVN_WORKER_ID: u8 = 2;
pub const OPTION_TYPE_PRECRIME: u8 = 1;

/// Group DVN options by their index
///
/// # Arguments
/// * `options` - The DVN options in format: [worker_id][dvn_option][worker_id][dvn_option]...
///               where dvn_option = [option_size][dvn_idx][option_type][option]
///               option_size = len(dvn_idx) + len(option_type) + len(option)
///               worker_id: u8, dvn_idx: u8, option_size: u16, option_type: u8, option: bytes
///
/// # Returns
/// * `Felt252Dict<Nullable<ByteArray>>` - The grouped options and their indices
pub fn group_dvn_options_by_idx(options: @ByteArray) -> Felt252Dict<Nullable<ByteArray>> {
    let mut ret: Felt252Dict<Nullable<ByteArray>> = Default::default();
    if options.len() == 0 {
        return ret;
    }

    let mut cursor: usize = 0;

    while cursor != options.len() {
        let DvnOption {
            option_size, dvn_index, option_type, option_data, cursor: new_cursor,
        } = next_dvn_option(options, cursor);
        let option = post_process_option(option_size, dvn_index, option_type, @option_data);

        // Get the existing entry for this dvn_index
        let (entry, prev_value) = ret.entry(dvn_index.into());

        // Combine the new option with any existing options for this dvn_index
        let combined_options = match match_nullable(prev_value) {
            FromNullableResult::Null => option,
            FromNullableResult::NotNull(existing) => {
                let mut result = existing.unbox();
                result.append(@option);
                result
            },
        };

        // Store the combined options back in the dictionary
        ret = entry.finalize(NullableTrait::new(combined_options));
        cursor = new_cursor;
    }

    ret
}

/// Post-process the option - prefixes other args to the option data
///
/// # Arguments
///
/// * `option_size` - The size of the option
///
/// * `dvn_index` - The index of the DVN
///
/// * `option_type` - The type of the option (e.g. PRECRIME)
///
/// * `option_data` - The data of the option
///
/// # Returns
///
/// * [`ByteArray`] - The post-processed option
pub fn post_process_option(
    option_size: u16, dvn_index: u8, option_type: u8, option_data: @ByteArray,
) -> ByteArray {
    let mut result: ByteArray = Default::default();

    result.append_byte(DVN_WORKER_ID);
    result.append_u16(option_size);
    result.append_byte(dvn_index);
    result.append_byte(option_type);
    result.append(option_data);

    result
}

/// Decode the next DVN option from options starting from the specified cursor
///
/// # Arguments
///
/// * `options` - The DVN options byte array
///
/// * `cursor` - The cursor position to start decoding from
///
/// # Returns
///
/// * [`DvnOption`] - The decoded option type, option data, and new cursor position
pub fn next_dvn_option(options: @ByteArray, cursor: usize) -> DvnOption {
    // Ensure we have enough bytes to read worker id
    assert_with_byte_array(cursor < options.len(), err_invalid_dvn_options(cursor));

    // skip dvn_id, always equal to DVN_WORKER_ID here = 2;
    let cursor = cursor + 1;

    let (cursor, option_size) = options.read_u16(cursor);
    assert_with_byte_array(option_size > 2, err_invalid_dvn_options(cursor));

    let (cursor, dvn_index) = options.read_u8(cursor);
    let (cursor, option_type) = options.read_u8(cursor);

    // Calculate the length of just the option data (excluding dvn_index and option_type)
    // option_length includes dvn_index (1 byte) + option_type (1 byte) + option data
    let option_data_length = option_size - 2; // subtract 2 bytes for dvn_index and option_type

    // Extract the option data
    let (final_cursor, option) = options.read_bytes(cursor, option_data_length.into());

    DvnOption { option_size, dvn_index, option_type, option_data: option, cursor: final_cursor }
}
