//! Messaging composer errors

use lz_utils::bytes::Bytes32;
use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum MessagingChannelError {
    /// Triggered when a compose message already exists and cannot be overwritten.
    LzComposeAlreadyExists,
    /// Triggered when a compose message is not found.
    LzComposeNotFound,
    /// Triggered when the value sent with a compose message exceeds the token allowance.
    LzComposeValueExceedsAllowance,
    /// Triggered when a transfer fails.
    TransferFailed,
}

impl ErrorNameImpl of Error<MessagingChannelError> {
    fn prefix() -> ByteArray {
        "LZ_MESSAGING_COMPOSER"
    }

    fn name(self: MessagingChannelError) -> ByteArray {
        match self {
            MessagingChannelError::LzComposeAlreadyExists => "LZ_COMPOSE_ALREADY_EXISTS",
            MessagingChannelError::LzComposeNotFound => "LZ_COMPOSE_NOT_FOUND",
            MessagingChannelError::LzComposeValueExceedsAllowance => "LZ_COMPOSE_VALUE_EXCEEDS_ALLOWANCE",
            MessagingChannelError::TransferFailed => "TRANSFER_FAILED",
        }
    }
}

pub fn err_lz_compose_not_found(expected_hash: Bytes32, actual_hash: Bytes32) -> ByteArray {
    format_error(
        MessagingChannelError::LzComposeNotFound,
        format!("Expected hash: {}, Actual hash: {}", expected_hash.value, actual_hash.value),
    )
}

pub fn err_lz_compose_value_exceeds_allowance(value: u256, allowance: u256) -> ByteArray {
    format_error(
        MessagingChannelError::LzComposeValueExceedsAllowance,
        format!("Value: {}, Allowance: {}", value, allowance),
    )
}

pub fn err_lz_compose_already_exists() -> ByteArray {
    format_error(MessagingChannelError::LzComposeAlreadyExists, "")
}

pub fn err_transfer_failed() -> ByteArray {
    format_error(MessagingChannelError::TransferFailed, "")
}
