//! Executor options

use core::byte_array::{ByteArray, ByteArrayTrait};
use lz_utils::byte_array_ext::byte_array_ext::ByteArrayTraitExt;
use lz_utils::error::assert_with_byte_array;
use crate::workers::executor::errors;
use crate::workers::executor::structs::{
    ExecutorOption, LzComposeOption, LzReadOption, LzReceiveOption, NativeDropOption,
};

// Constants
pub const OPTION_TYPE_LZRECEIVE: u8 = 1;
pub const OPTION_TYPE_NATIVE_DROP: u8 = 2;
pub const OPTION_TYPE_LZCOMPOSE: u8 = 3;
pub const OPTION_TYPE_ORDERED_EXECUTION: u8 = 4;
pub const OPTION_TYPE_LZREAD: u8 = 5;

pub const EXECUTOR_WORKER_ID: u8 = 1;

// This struct holds the aggregated values from parsing the executor options.
#[derive(Default, Drop, Serde, Debug)]
pub struct ExecutorOptionsAggregated {
    // The total native value to be sent with the message.
    pub total_value: u128,
    // The total gas limit for the message execution.
    pub total_gas: u128,
    // A flag indicating if ordered execution is requested.
    pub ordered: bool,
    // The number of `lz_compose` options.
    pub num_lz_compose: u32,
    // The size of the calldata.
    pub calldata_size: u32,
    // The gas for `lzReceive`.
    pub lz_receive_gas: u128,
}

// This struct holds the decoded/calculated values needed for quoting.
#[derive(Copy, Drop, Serde, Debug, PartialEq)]
pub struct PriceFeedParams {
    // The total native value to be sent with the message.
    pub total_value: u256,
    // The total gas limit for the message execution.
    pub total_gas: u256,
    // The size of the calldata.
    pub calldata_size: u32,
}

pub fn _decode_executor_options(
    is_read: bool,
    is_v1_eid: bool,
    lz_receive_base_gas: u256,
    lz_compose_base_gas: u256,
    native_cap: u128,
    options: @ByteArray,
) -> PriceFeedParams {
    let parsed_options = _parse_options_to_array(options);
    let agg_options = _aggregate_options(parsed_options.span(), is_read, is_v1_eid, native_cap);

    // lz receive only called once
    // lz compose can be called multiple times, based on unique index
    // to simplify the quoting, we add lzComposeBaseGas for each lzComposeOption received
    // if the same index has multiple compose options, the gas will be added multiple times
    let mut total_gas: u256 = lz_receive_base_gas
        + agg_options.total_gas.into()
        + lz_compose_base_gas * agg_options.num_lz_compose.into();
    if agg_options.ordered {
        total_gas = (total_gas * 102) / 100;
    }

    PriceFeedParams {
        total_value: agg_options.total_value.into(),
        total_gas: total_gas,
        calldata_size: agg_options.calldata_size,
    }
}


pub fn _parse_options_to_array(options_bytes: @ByteArray) -> Array<ExecutorOption> {
    assert_with_byte_array(options_bytes.len() > 0, errors::err_no_options());

    let mut options_arr = array![];
    let mut cursor: usize = 0;
    let total_len = options_bytes.len();

    while cursor != total_len {
        assert_with_byte_array(cursor < total_len, errors::err_malformed_options());
        // skip worker id
        cursor += 1;

        let (cursor_after_len, option_len_total_u16) = options_bytes.read_u16(cursor);
        let option_len_total: usize = option_len_total_u16.into();
        cursor = cursor_after_len;

        // ensure we have at least one byte for the option type
        assert_with_byte_array(cursor < total_len, errors::err_malformed_options());
        let (cursor_after_type, option_type) = options_bytes.read_u8(cursor);
        cursor = cursor_after_type;

        // option_len_total includes the type byte; payload length excludes it
        assert_with_byte_array(option_len_total > 0, errors::err_malformed_options());
        let option_len: usize = option_len_total - 1;

        let option_data_start_offset = cursor;
        // ensure payload fits within the total buffer
        assert_with_byte_array(
            option_data_start_offset + option_len <= total_len, errors::err_malformed_options(),
        );

        if option_type == OPTION_TYPE_LZRECEIVE {
            let lz_receive_option = _read_lz_receive_option(
                options_bytes, option_data_start_offset, option_len,
            );
            options_arr.append(ExecutorOption::LzReceive(lz_receive_option));
        } else if option_type == OPTION_TYPE_NATIVE_DROP {
            let native_drop_option = _read_native_drop_option(
                options_bytes, option_data_start_offset, option_len,
            );
            options_arr.append(ExecutorOption::NativeDrop(native_drop_option));
        } else if option_type == OPTION_TYPE_LZCOMPOSE {
            let lz_compose_option = _read_lz_compose_option(
                options_bytes, option_data_start_offset, option_len,
            );
            options_arr.append(ExecutorOption::LzCompose(lz_compose_option));
        } else if option_type == OPTION_TYPE_ORDERED_EXECUTION {
            options_arr.append(ExecutorOption::OrderedExecution);
        } else {
            assert_with_byte_array(
                option_type == OPTION_TYPE_LZREAD, errors::err_unsupported_option_type(),
            );
            let lz_read_option = _read_lz_read_option(
                options_bytes, option_data_start_offset, option_len,
            );
            options_arr.append(ExecutorOption::LzRead(lz_read_option));
        }
        cursor = option_data_start_offset + option_len;
    }

    options_arr
}

// equivalent to _parseExecutorOptions in ExecutorFeeLib.sol
pub fn _aggregate_options(
    options_span: Span<ExecutorOption>, is_read: bool, is_v1_eid: bool, native_cap: u128,
) -> ExecutorOptionsAggregated {
    let mut options = ExecutorOptionsAggregated {
        total_value: 0,
        total_gas: 0,
        ordered: false,
        num_lz_compose: 0,
        calldata_size: 0,
        lz_receive_gas: 0,
    };

    let mut temp_options = options_span;
    while let Option::Some(option) = temp_options.pop_front() {
        match option {
            ExecutorOption::LzReceive(lz_receive_option) => {
                assert_with_byte_array(!is_read, errors::err_unsupported_option_lz_receive());
                assert_with_byte_array(
                    !is_v1_eid || *lz_receive_option.value == 0,
                    errors::err_unsupported_receive_with_value(),
                );
                options.total_value += *lz_receive_option.value;
                options.lz_receive_gas += *lz_receive_option.gas;
            },
            ExecutorOption::NativeDrop(native_drop_option) => {
                assert_with_byte_array(!is_read, errors::err_unsupported_option_native_drop());
                options.total_value += *native_drop_option.amount;
            },
            ExecutorOption::LzCompose(lz_compose_option) => {
                assert_with_byte_array(!is_v1_eid, errors::err_unsupported_option_lz_compose());
                assert_with_byte_array(
                    *lz_compose_option.gas > 0, errors::err_zero_lz_compose_gas(),
                );
                options.total_value += *lz_compose_option.value;
                options.total_gas += *lz_compose_option.gas;
                options.num_lz_compose += 1;
            },
            ExecutorOption::OrderedExecution => { options.ordered = true; },
            ExecutorOption::LzRead(lz_read_option) => {
                assert_with_byte_array(is_read, errors::err_unsupported_option_lz_read());
                options.total_value += *lz_read_option.value;
                options.lz_receive_gas += *lz_read_option.gas;
                options.calldata_size += *lz_read_option.size;
            },
        }
    }

    assert_with_byte_array(
        options.total_value <= native_cap, errors::err_native_amount_exceeds_cap(),
    );
    assert_with_byte_array(options.lz_receive_gas > 0, errors::err_zero_lz_receive_gas());
    if is_read {
        assert_with_byte_array(options.calldata_size > 0, errors::err_zero_calldata_size());
    }
    options.total_gas += options.lz_receive_gas;
    options
}

// Decoding helper functions
pub fn _read_lz_receive_option(b: @ByteArray, offset: usize, len: usize) -> LzReceiveOption {
    assert_with_byte_array(len == 16 || len == 32, errors::err_invalid_lz_receive_option());
    let (offset, gas) = b.read_u128(offset);
    let value = if len == 32 {
        let (_, value) = b.read_u128(offset);
        value
    } else {
        0
    };
    LzReceiveOption { gas, value }
}

pub fn _read_native_drop_option(b: @ByteArray, offset: usize, len: usize) -> NativeDropOption {
    assert_with_byte_array(len == 48, errors::err_invalid_native_drop_option());
    let (offset, amount) = b.read_u128(offset);
    let (_, receiver) = b.read_u256(offset);
    NativeDropOption { amount, receiver: receiver.into() }
}

pub fn _read_lz_compose_option(b: @ByteArray, offset: usize, len: usize) -> LzComposeOption {
    assert_with_byte_array(len == 18 || len == 34, errors::err_invalid_lz_compose_option());
    let (offset, index) = b.read_u16(offset);
    let (offset, gas) = b.read_u128(offset);
    let value = if len == 34 {
        let (_, value) = b.read_u128(offset);
        value
    } else {
        0
    };
    LzComposeOption { index, gas, value }
}

pub fn _read_lz_read_option(b: @ByteArray, offset: usize, len: usize) -> LzReadOption {
    assert_with_byte_array(len == 20 || len == 36, errors::err_invalid_lz_read_option());
    let (offset, gas) = b.read_u128(offset);
    let (offset, size) = b.read_u32(offset);
    let value = if len == 36 {
        let (_, value) = b.read_u128(offset);
        value
    } else {
        0
    };
    LzReadOption { gas, size, value }
}
