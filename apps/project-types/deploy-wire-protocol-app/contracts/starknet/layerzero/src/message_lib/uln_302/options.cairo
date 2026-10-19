use core::byte_array::{ByteArray, ByteArrayTrait};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::error::assert_with_byte_array;

// Import error functions
use crate::message_lib::uln_302::errors::{
    err_invalid_worker_id, err_invalid_worker_options, err_unsupported_option_type,
};
use crate::workers::dvn::options::DVN_WORKER_ID;
use crate::workers::executor::options::EXECUTOR_WORKER_ID;

// Option type constants
pub const TYPE_3: u16 = 3;

/// Decode the options into executor_options and dvn_options
///
/// # Arguments
/// * `options` - The options can be either legacy options (type 1 or 2) or type 3 options
///
/// # Returns
/// * `(executor_options, dvn_options)` - The executor options and DVN options in type 3 format
pub fn split_options(options: @ByteArray) -> (ByteArray, ByteArray) {
    // At least 2 bytes for the option type, but can have no options
    assert_with_byte_array(options.len() >= 2, err_invalid_worker_options(0));

    // we don't support legacy options here, only allowing option type 3
    let (mut cursor, options_type) = options.read_u16(0);
    assert_with_byte_array(options_type == TYPE_3, err_unsupported_option_type(options_type));

    // Type3 options: [worker_option][worker_option]...
    // worker_option: [worker_id][option_size][option]
    // worker_id: u8, option_size: u16, option: bytes

    let mut executor_options: ByteArray = Default::default();
    let mut dvn_options: ByteArray = Default::default();

    while cursor != options.len() {
        // worker_id can't be zero
        let (new_cursor, worker_id) = options.read_u8(cursor);
        assert_with_byte_array(worker_id != 0, err_invalid_worker_id(0));

        let (new_cursor, options_size) = options.read_u16(new_cursor);
        assert_with_byte_array(options_size != 0, err_invalid_worker_options(new_cursor));

        let (new_cursor, option) = options.read_bytes(new_cursor, options_size.into());

        if worker_id == EXECUTOR_WORKER_ID {
            executor_options.append_u8(EXECUTOR_WORKER_ID);
            executor_options.append_u16(options_size);
            executor_options.append(@option);
        } else {
            assert_with_byte_array(worker_id == DVN_WORKER_ID, err_invalid_worker_id(worker_id));
            dvn_options.append_u8(DVN_WORKER_ID);
            dvn_options.append_u16(options_size);
            dvn_options.append(@option);
        }
        cursor = new_cursor;

        // The cursor must never exceed option length
        assert_with_byte_array(cursor <= options.len(), err_invalid_worker_options(cursor));
    }

    (executor_options, dvn_options)
}
