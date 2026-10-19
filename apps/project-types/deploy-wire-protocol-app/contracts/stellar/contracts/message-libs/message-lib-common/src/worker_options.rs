use crate::errors::WorkerOptionsError;
use soroban_sdk::{assert_with_error, bytes, map, panic_with_error, Bytes, BytesN, Env, Map};
use utils::{buffer_reader::BufferReader, buffer_writer::BufferWriter, option_ext::OptionExt};

// Option type constants
pub const LEGACY_OPTIONS_TYPE_1: u16 = 1; // legacy options type 1
pub const LEGACY_OPTIONS_TYPE_2: u16 = 2; // legacy options type 2
pub const OPTIONS_TYPE_3: u16 = 3; // modern options type 3

// Worker ID constants
pub const EXECUTOR_WORKER_ID: u8 = 1;
pub const DVN_WORKER_ID: u8 = 2;

// Executor option type constants
pub const EXECUTOR_OPTION_TYPE_LZRECEIVE: u8 = 1;
pub const EXECUTOR_OPTION_TYPE_NATIVE_DROP: u8 = 2;

// DVN option byte offset for the dvn_idx field after the worker_id and option_size fields
pub const DVN_IDX_OFFSET: u32 = 3;

/// Splits worker options into separate executor and DVN option collections.
///
/// This is the main entry point for processing worker options. It automatically
/// detects the option format version and delegates to the appropriate parser.
///
/// Format detection:
/// - Type 3: Modern flexible format with multiple worker types
/// - Type 1 & 2: Legacy formats (executor options only, no DVN options)
///
/// # Arguments
/// * `options` - The raw options bytes
///
/// # Returns
/// A tuple of (executor_options, dvn_options_map)
pub fn split_worker_options(env: &Env, options: &Bytes) -> (Bytes, Map<u32, Bytes>) {
    assert_with_error!(env, options.len() >= 2, WorkerOptionsError::InvalidOptions);

    let mut reader = BufferReader::new(options);
    let options_type = reader.read_u16();

    if options_type == OPTIONS_TYPE_3 {
        extract_type_3_options(env, &mut reader)
    } else {
        let executor_options = convert_legacy_options(env, &mut reader, options_type);
        (executor_options, map![env])
    }
}

/// Extracts options from the modern Type 3 format.
///
/// Type 3 format supports multiple workers (executors and DVNs) with flexible
/// option structures. Each worker option includes its own size header.
///
/// Format Structure:
/// ```text
/// [worker_option][worker_option][worker_option]...
///
/// Worker Option:
/// [worker_id: u8][option_size: u16][option_data: bytes(option_size)]
/// ```
///
/// # Arguments
/// * `options_reader` - Buffer reader positioned after the options type header
///
/// # Returns
/// A tuple of (executor_options, dvn_options_map)
pub fn extract_type_3_options(env: &Env, options_reader: &mut BufferReader) -> (Bytes, Map<u32, Bytes>) {
    let mut executor_options = bytes!(env);
    let mut dvn_options = map![env];
    while options_reader.remaining_len() > 0 {
        let worker_id = options_reader.read_u8();
        let option_size = options_reader.read_u16() as u32;
        assert_with_error!(env, option_size > 0, WorkerOptionsError::InvalidOptions);

        // Rewind to the start of the current option and read the complete option bytes
        // 3 bytes for worker_id (1) + option_size (2)
        let current_option = options_reader.rewind(3).read_bytes(3 + option_size);

        match worker_id {
            EXECUTOR_WORKER_ID => executor_options.append(&current_option),
            DVN_WORKER_ID => append_dvn_option(env, &mut dvn_options, current_option),
            _ => panic_with_error!(env, WorkerOptionsError::InvalidWorkerId),
        }
    }
    (executor_options, dvn_options)
}

/// Converts legacy option formats (Type 1 and Type 2) to executor options in Type 3 format.
///
/// Legacy formats only supported executor options and did not include DVN options.
///
/// Legacy Format Details:
/// - **Type 1**: `[execution_gas: u256]` (32 bytes total)
/// - **Type 2**: `[execution_gas: u256][amount: u256][receiver: bytes(1-32)]` (65-96 bytes total)
///
/// Note: Legacy formats use u256 for gas/amounts, but Type 3 uses u128.
/// The conversion will panic if values exceed u128 range.
///
/// # Arguments
/// * `options` - Buffer reader positioned after the options type header
/// * `option_type` - The legacy option type (1 or 2)
///
/// # Returns
/// Executor options in Type 3 format
pub fn convert_legacy_options(env: &Env, options: &mut BufferReader, option_type: u16) -> Bytes {
    let mut executor_options = BufferWriter::new(env);
    let options_size = options.remaining_len();

    match option_type {
        LEGACY_OPTIONS_TYPE_1 => {
            assert_with_error!(env, options_size == 32, WorkerOptionsError::InvalidLegacyOptionsType1);
            // Execution gas (u256 -> u128)
            let execution_gas =
                options.read_u256().to_u128().unwrap_or_panic(env, WorkerOptionsError::LegacyOptionsType1GasOverflow);
            append_lz_receive_option(&mut executor_options, execution_gas);
        }
        LEGACY_OPTIONS_TYPE_2 => {
            assert_with_error!(
                env,
                options_size > 64 && options_size <= 96,
                WorkerOptionsError::InvalidLegacyOptionsType2
            );
            // Execution gas & amount (u256 -> u128)
            let execution_gas =
                options.read_u256().to_u128().unwrap_or_panic(env, WorkerOptionsError::LegacyOptionsType2GasOverflow);
            let amount = options
                .read_u256()
                .to_u128()
                .unwrap_or_panic(env, WorkerOptionsError::LegacyOptionsType2AmountOverflow);
            let receiver = left_pad_to_bytes32(env, &options.read_bytes_until_end());

            append_lz_receive_option(&mut executor_options, execution_gas);
            append_native_drop_option(&mut executor_options, amount, &receiver);
        }
        _ => panic_with_error!(env, WorkerOptionsError::InvalidOptionType),
    }

    // Ensure all bytes were consumed
    assert_with_error!(env, options.remaining_len() == 0, WorkerOptionsError::InvalidOptions);
    executor_options.to_bytes()
}

// ========================================================
// Internal Helper Functions
// ========================================================

/// Efficiently groups DVN options by index.
///
/// Searches for existing DVN options with the same index and concatenates them,
/// or creates a new entry if this is the first option for this DVN index.
///
/// DVN option_bytes layout: `[worker_id: u8][option_size: u16][dvn_idx: u8][dvn_option_data: bytes]`
/// The dvn_idx at byte offset 3 (DVN_IDX_OFFSET) identifies which DVN this option belongs to.
fn append_dvn_option(env: &Env, dvn_options: &mut Map<u32, Bytes>, option_bytes: Bytes) {
    let dvn_idx = option_bytes.get(DVN_IDX_OFFSET).unwrap_or_panic(env, WorkerOptionsError::InvalidOptions) as u32;
    let mut existing = dvn_options.get(dvn_idx).unwrap_or(bytes!(env));
    existing.append(&option_bytes);
    dvn_options.set(dvn_idx, existing);
}

/// Appends a LzReceive option to the executor options bytes.
/// Format: [worker_id][option_size][option_type][execution_gas]
fn append_lz_receive_option(buf: &mut BufferWriter, execution_gas: u128) {
    buf.write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
        .write_u16(17) // option_size: option_type(1) + data(16) = 17 bytes
        .write_u8(EXECUTOR_OPTION_TYPE_LZRECEIVE) // option_type (1 byte)
        .write_u128(execution_gas); // execution gas data (16 bytes)
}

/// Appends a native drop option to the executor options bytes.
/// Format: [worker_id][option_size][option_type][amount][receiver]
fn append_native_drop_option(buf: &mut BufferWriter, amount: u128, receiver: &BytesN<32>) {
    buf.write_u8(EXECUTOR_WORKER_ID) // worker_id (1 byte)
        .write_u16(49) // option_size: option_type(1) + amount(16) + receiver(32) = 49 bytes
        .write_u8(EXECUTOR_OPTION_TYPE_NATIVE_DROP) // option_type (1 byte)
        .write_u128(amount) // drop amount (16 bytes)
        .write_bytes_n(receiver); // receiver address (32 bytes)
}

/// Converts Bytes to BytesN<32> with left-padding (zeros at the beginning)
fn left_pad_to_bytes32(env: &Env, bytes: &Bytes) -> BytesN<32> {
    assert_with_error!(env, bytes.len() <= 32, WorkerOptionsError::InvalidBytesLength);
    let mut buf = [0u8; 32];
    bytes.copy_into_slice(&mut buf[32 - bytes.len() as usize..]);
    BytesN::from_array(env, &buf)
}

// ========================================================
// Test-only wrappers for internal helper functions
// ========================================================
//
// These allow unit tests under `src/tests/...` (a sibling module of `worker_options`)
// to exercise internal helpers without changing their visibility in production builds.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) mod test {
    use super::*;

    pub fn append_dvn_option_for_test(env: &Env, dvn_options: &mut Map<u32, Bytes>, option_bytes: Bytes) {
        super::append_dvn_option(env, dvn_options, option_bytes)
    }

    pub fn append_lz_receive_option_for_test(env: &Env, execution_gas: u128) -> Bytes {
        let mut buf = BufferWriter::new(env);
        super::append_lz_receive_option(&mut buf, execution_gas);
        buf.to_bytes()
    }

    pub fn append_native_drop_option_for_test(env: &Env, amount: u128, receiver: &BytesN<32>) -> Bytes {
        let mut buf = BufferWriter::new(env);
        super::append_native_drop_option(&mut buf, amount, receiver);
        buf.to_bytes()
    }

    pub fn left_pad_to_bytes32_for_test(env: &Env, bytes: &Bytes) -> BytesN<32> {
        super::left_pad_to_bytes32(env, bytes)
    }
}
