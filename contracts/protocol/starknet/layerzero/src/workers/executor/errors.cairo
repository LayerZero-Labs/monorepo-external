//! Executor errors

use core::byte_array::ByteArray;
use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum ExecutorError {
    /// The endpoint ID is not supported.
    EidNotSupported,
    /// The `lz_compose` option is invalid.
    InvalidLzComposeOption,
    /// The `lz_read` option is invalid.
    InvalidLzReadOption,
    /// The `lz_receive` option is invalid.
    InvalidLzReceiveOption,
    /// The native drop option is invalid.
    InvalidNativeDropOption,
    /// The options are invalid.
    InvalidOptions,
    /// The options are malformed.
    MalformedOptions,
    /// The native amount exceeds the cap.
    NativeAmountExceedsCap,
    /// No options were provided.
    NoOptions,
    /// The price feed is not set.
    PriceFeedNotSet,
    /// The `lz_compose` option is not supported.
    UnsupportedOptionLzCompose,
    /// The `lz_read` option is not supported.
    UnsupportedOptionLzRead,
    /// The `lz_receive` option is not supported.
    UnsupportedOptionLzReceive,
    /// The native drop option is not supported.
    UnsupportedOptionNativeDrop,
    /// The option type is not supported.
    UnsupportedOptionType,
    /// Receive with value is not supported.
    UnsupportedReceiveWithValue,
    /// The worker fee library is not set.
    WorkerFeeLibNotSet,
    /// The calldata size is zero.
    ZeroCalldataSize,
    /// The `lz_compose` gas is zero.
    ZeroLzComposeGas,
    /// The `lz_receive` gas is zero.
    ZeroLzReceiveGas,
    /// ERC-20 transfer failed.
    TransferFailed,
    /// ERC-20 approval failed.
    ApprovalFailed,
}

impl ErrorNameImpl of Error<ExecutorError> {
    fn prefix() -> ByteArray {
        "LZ_EXECUTOR"
    }

    fn name(self: ExecutorError) -> ByteArray {
        match self {
            ExecutorError::EidNotSupported => "EID_NOT_SUPPORTED",
            ExecutorError::InvalidLzComposeOption => "INVALID_LZ_COMPOSE_OPTION",
            ExecutorError::InvalidLzReadOption => "INVALID_LZ_READ_OPTION",
            ExecutorError::InvalidLzReceiveOption => "INVALID_LZ_RECEIVE_OPTION",
            ExecutorError::InvalidNativeDropOption => "INVALID_NATIVE_DROP_OPTION",
            ExecutorError::InvalidOptions => "INVALID_OPTIONS",
            ExecutorError::MalformedOptions => "MALFORMED_OPTIONS",
            ExecutorError::NativeAmountExceedsCap => "NATIVE_AMOUNT_EXCEEDS_CAP",
            ExecutorError::NoOptions => "NO_OPTIONS",
            ExecutorError::PriceFeedNotSet => "PRICE_FEED_NOT_SET",
            ExecutorError::UnsupportedOptionLzCompose => "UNSUPPORTED_OPTION_LZ_COMPOSE",
            ExecutorError::UnsupportedOptionLzRead => "UNSUPPORTED_OPTION_LZ_READ",
            ExecutorError::UnsupportedOptionLzReceive => "UNSUPPORTED_OPTION_LZ_RECEIVE",
            ExecutorError::UnsupportedOptionNativeDrop => "UNSUPPORTED_OPTION_NATIVE_DROP",
            ExecutorError::UnsupportedOptionType => "UNSUPPORTED_OPTION_TYPE",
            ExecutorError::UnsupportedReceiveWithValue => "UNSUPPORTED_RECEIVE_WITH_VALUE",
            ExecutorError::WorkerFeeLibNotSet => "WORKER_FEELIB_NOT_SET",
            ExecutorError::ZeroCalldataSize => "ZERO_CALLDATA_SIZE",
            ExecutorError::ZeroLzComposeGas => "ZERO_LZ_COMPOSE_GAS",
            ExecutorError::ZeroLzReceiveGas => "ZERO_LZ_RECEIVE_GAS",
            ExecutorError::TransferFailed => "TRANSFER_FAILED",
            ExecutorError::ApprovalFailed => "APPROVAL_FAILED",
        }
    }
}

pub fn err_eid_not_supported() -> ByteArray {
    format_error(ExecutorError::EidNotSupported, "")
}

pub fn err_price_feed_not_set() -> ByteArray {
    format_error(ExecutorError::PriceFeedNotSet, "")
}

pub fn err_worker_fee_lib_not_set() -> ByteArray {
    format_error(ExecutorError::WorkerFeeLibNotSet, "")
}

pub fn err_no_options() -> ByteArray {
    format_error(ExecutorError::NoOptions, "")
}

pub fn err_malformed_options() -> ByteArray {
    format_error(ExecutorError::MalformedOptions, "")
}

pub fn err_unsupported_option_lz_receive() -> ByteArray {
    format_error(ExecutorError::UnsupportedOptionLzReceive, "")
}

pub fn err_unsupported_receive_with_value() -> ByteArray {
    format_error(ExecutorError::UnsupportedReceiveWithValue, "")
}

pub fn err_unsupported_option_native_drop() -> ByteArray {
    format_error(ExecutorError::UnsupportedOptionNativeDrop, "")
}

pub fn err_unsupported_option_lz_compose() -> ByteArray {
    format_error(ExecutorError::UnsupportedOptionLzCompose, "")
}

pub fn err_zero_lz_compose_gas() -> ByteArray {
    format_error(ExecutorError::ZeroLzComposeGas, "")
}

pub fn err_unsupported_option_lz_read() -> ByteArray {
    format_error(ExecutorError::UnsupportedOptionLzRead, "")
}

pub fn err_unsupported_option_type() -> ByteArray {
    format_error(ExecutorError::UnsupportedOptionType, "")
}

pub fn err_invalid_options() -> ByteArray {
    format_error(ExecutorError::InvalidOptions, "")
}

pub fn err_native_amount_exceeds_cap() -> ByteArray {
    format_error(ExecutorError::NativeAmountExceedsCap, "")
}

pub fn err_zero_lz_receive_gas() -> ByteArray {
    format_error(ExecutorError::ZeroLzReceiveGas, "")
}

pub fn err_zero_calldata_size() -> ByteArray {
    format_error(ExecutorError::ZeroCalldataSize, "")
}

pub fn err_invalid_lz_receive_option() -> ByteArray {
    format_error(ExecutorError::InvalidLzReceiveOption, "")
}

pub fn err_invalid_native_drop_option() -> ByteArray {
    format_error(ExecutorError::InvalidNativeDropOption, "")
}

pub fn err_invalid_lz_compose_option() -> ByteArray {
    format_error(ExecutorError::InvalidLzComposeOption, "")
}

pub fn err_invalid_lz_read_option() -> ByteArray {
    format_error(ExecutorError::InvalidLzReadOption, "")
}

pub fn err_transfer_failed() -> ByteArray {
    format_error(ExecutorError::TransferFailed, "")
}

pub fn err_approval_failed() -> ByteArray {
    format_error(ExecutorError::ApprovalFailed, "")
}
