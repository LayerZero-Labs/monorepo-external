use crate::errors::ExecutorFeeLibError;
use message_lib_common::worker_options::{EXECUTOR_OPTION_TYPE_LZRECEIVE, EXECUTOR_OPTION_TYPE_NATIVE_DROP};
use soroban_sdk::{assert_with_error, panic_with_error, Bytes, BytesN, Env};
use utils::buffer_reader::BufferReader;

pub const EXECUTOR_OPTION_TYPE_LZCOMPOSE: u8 = 3;
pub const EXECUTOR_OPTION_TYPE_ORDERED_EXECUTION: u8 = 4;

/// Aggregated executor options parsed from encoded option bytes.
///
/// Contains the accumulated values from all executor options for fee calculation.
/// This structure is built by iterating through all encoded options and summing
/// gas requirements and native token values.
pub struct ExecutorOptionsAgg {
    /// Total native token value to transfer (from lzReceive value + nativeDrop + lzCompose value).
    pub total_value: u128,
    /// Total gas required (from lzReceive gas + lzCompose gas).
    pub total_gas: u128,
    /// Whether ordered execution is requested (messages must be delivered in sequence).
    pub ordered: bool,
    /// Number of lzCompose calls to execute.
    pub num_lz_compose: u64,
}

// ============================================================================
// Main Parsing Function
// ============================================================================

/// Parses executor options from encoded bytes and returns aggregated values.
///
/// Iterates through all encoded options, decoding each based on its type and
/// accumulating gas, value, and other parameters for fee calculation.
///
/// # Arguments
/// * `options` - Encoded executor options bytes
/// * `is_v1_eid` - Whether destination is a V1 endpoint (< 30000), which has restrictions
/// * `native_cap` - Maximum allowed native token value transfer
///
/// # Returns
/// `ExecutorOptionsAgg` containing accumulated gas, value, compose count, and ordered flag.
///
/// # Errors
/// * `NoOptions` - If options bytes are empty
/// * `UnsupportedOptionType` - If an unknown option type is encountered or V1 restrictions violated
/// * `ZeroLzReceiveGasProvided` - If no lzReceive gas is specified
/// * `ZeroLzComposeGasProvided` - If lzCompose has zero gas
/// * `NativeAmountExceedsCap` - If total native value exceeds the cap
pub fn parse_executor_options(env: &Env, options: &Bytes, is_v1_eid: bool, native_cap: u128) -> ExecutorOptionsAgg {
    // Assert that options are not empty (No executor options provided)
    assert_with_error!(env, !options.is_empty(), ExecutorFeeLibError::NoOptions);

    let mut reader = BufferReader::new(options);

    let mut agg_options = ExecutorOptionsAgg { total_value: 0, total_gas: 0, ordered: false, num_lz_compose: 0 };

    let mut lz_receive_gas: u128 = 0;

    while reader.remaining_len() > 0 {
        let (option_type, option_data) = next_executor_option(&mut reader);

        match option_type {
            EXECUTOR_OPTION_TYPE_LZRECEIVE => {
                let (gas, value) = decode_lz_receive_option(env, &option_data);
                // endpoint v1 does not support lzReceive with value
                assert_with_error!(env, !(is_v1_eid && value > 0), ExecutorFeeLibError::UnsupportedOptionType);
                lz_receive_gas += gas;
                agg_options.total_value += value;
            }
            EXECUTOR_OPTION_TYPE_NATIVE_DROP => {
                let (amount, _) = decode_native_drop_option(env, &option_data);
                agg_options.total_value += amount;
            }
            EXECUTOR_OPTION_TYPE_LZCOMPOSE => {
                // endpoint v1 does not support lzCompose
                assert_with_error!(env, !is_v1_eid, ExecutorFeeLibError::UnsupportedOptionType);
                let (_, gas, value) = decode_lz_compose_option(env, &option_data);
                assert_with_error!(env, gas != 0, ExecutorFeeLibError::ZeroLzComposeGasProvided);
                agg_options.total_gas += gas;
                agg_options.total_value += value;
                agg_options.num_lz_compose += 1;
            }
            EXECUTOR_OPTION_TYPE_ORDERED_EXECUTION => {
                agg_options.ordered = true;
            }
            _ => {
                panic_with_error!(env, ExecutorFeeLibError::UnsupportedOptionType);
            }
        }
    }

    // Validate
    assert_with_error!(env, agg_options.total_value <= native_cap, ExecutorFeeLibError::NativeAmountExceedsCap);
    assert_with_error!(env, lz_receive_gas != 0, ExecutorFeeLibError::ZeroLzReceiveGasProvided);

    agg_options.total_gas += lz_receive_gas;
    agg_options
}

// ============================================================================
// Option Extraction
// ============================================================================

/// Extracts the next executor option from the options byte stream.
///
/// Option format: [worker_id: u8][option_size: u16][option_type: u8][option_data: bytes]
///
/// Parses the binary format to extract the option type and data, skipping the worker_id
/// which identifies which worker this option is intended for.
///
/// # Arguments
/// * `reader` - Buffer reader positioned at the start of an option
///
/// # Returns
/// Tuple of (option_type, option_data) where option_data excludes the option_type byte.
fn next_executor_option(reader: &mut BufferReader) -> (u8, Bytes) {
    // Skip worker_id (1 byte) - identifies which worker this option is for
    let _worker_id = reader.read_u8();

    // Read option_size (2 bytes) - includes option_type + option_data
    let option_size = reader.read_u16();

    // Read option_type (1 byte)
    let option_type = reader.read_u8();

    // Read option_data (option_size - 1 bytes, since option_size includes option_type)
    let option_data = reader.read_bytes((option_size - 1) as u32);

    (option_type, option_data)
}

// ============================================================================
// Option Decoding Functions
// ============================================================================

/// Decodes an lzReceive option.
///
/// Format: [gas: u128] (16 bytes) or [gas: u128][value: u128] (32 bytes)
///
/// # Arguments
/// * `option` - The option data bytes (without option_type)
///
/// # Returns
/// Tuple of (gas, value) where value is 0 if not specified.
///
/// # Errors
/// * `InvalidLzReceiveOption` - If option length is not 16 or 32 bytes.
fn decode_lz_receive_option(env: &Env, option: &Bytes) -> (u128, u128) {
    let len = option.len();
    assert_with_error!(env, len == 16 || len == 32, ExecutorFeeLibError::InvalidLzReceiveOption);

    let mut reader = BufferReader::new(option);
    let gas = reader.read_u128();
    let value = if len == 32 { reader.read_u128() } else { 0 };

    (gas, value)
}

/// Decodes a native drop option.
///
/// Format: [amount: u128][receiver: bytes32] (48 bytes)
///
/// # Arguments
/// * `option` - The option data bytes (without option_type)
///
/// # Returns
/// Tuple of (amount, receiver) for the native token transfer.
///
/// # Errors
/// * `InvalidNativeDropOption` - If option length is not 48 bytes.
fn decode_native_drop_option(env: &Env, option: &Bytes) -> (u128, BytesN<32>) {
    assert_with_error!(env, option.len() == 48, ExecutorFeeLibError::InvalidNativeDropOption);

    let mut reader = BufferReader::new(option);
    let amount = reader.read_u128();
    let receiver = reader.read_bytes_n::<32>();

    (amount, receiver)
}

/// Decodes an lzCompose option.
///
/// Format: [index: u16][gas: u128] (18 bytes) or [index: u16][gas: u128][value: u128] (34 bytes)
///
/// # Arguments
/// * `option` - The option data bytes (without option_type)
///
/// # Returns
/// Tuple of (index, gas, value) where value is 0 if not specified.
///
/// # Errors
/// * `InvalidLzComposeOption` - If option length is not 18 or 34 bytes.
fn decode_lz_compose_option(env: &Env, option: &Bytes) -> (u16, u128, u128) {
    let len = option.len();
    assert_with_error!(env, len == 18 || len == 34, ExecutorFeeLibError::InvalidLzComposeOption);

    let mut reader = BufferReader::new(option);
    let index = reader.read_u16();
    let gas = reader.read_u128();
    let value = if len == 34 { reader.read_u128() } else { 0 };

    (index, gas, value)
}

// ========================================================
// Test-only wrappers for internal helper functions
// ========================================================
//
// These allow unit tests under `src/tests/...` (a sibling module of `executor_option`)
// to exercise internal helpers without changing their visibility in production builds.
#[cfg(test)]
#[allow(dead_code)]
pub(crate) mod test {
    use super::*;

    pub fn next_executor_option_for_test(reader: &mut BufferReader) -> (u8, Bytes) {
        super::next_executor_option(reader)
    }

    pub fn decode_lz_receive_option_for_test(env: &Env, option: &Bytes) -> (u128, u128) {
        super::decode_lz_receive_option(env, option)
    }

    pub fn decode_native_drop_option_for_test(env: &Env, option: &Bytes) -> (u128, BytesN<32>) {
        super::decode_native_drop_option(env, option)
    }

    pub fn decode_lz_compose_option_for_test(env: &Env, option: &Bytes) -> (u16, u128, u128) {
        super::decode_lz_compose_option(env, option)
    }
}
