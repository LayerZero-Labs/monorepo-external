//! Messaging channel errors

use lz_utils::bytes::Bytes32;
use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum MessagingChannelError {
    /// Triggered when a message with an invalid nonce is received.
    InvalidNonce,
    /// Triggered when the payload hash of a received message does not match the committed payload
    /// hash.
    PayloadHashNotFound,
}

impl ErrorNameImpl of Error<MessagingChannelError> {
    fn prefix() -> ByteArray {
        "LZ_MESSAGING_CHANNEL"
    }

    fn name(self: MessagingChannelError) -> ByteArray {
        match self {
            MessagingChannelError::InvalidNonce => "INVALID_NONCE",
            MessagingChannelError::PayloadHashNotFound => "PAYLOAD_HASH_NOT_FOUND",
        }
    }
}

pub fn err_invalid_nonce() -> ByteArray {
    format_error(MessagingChannelError::InvalidNonce, "")
}

pub fn err_payload_hash_not_found(expected_hash: Bytes32, actual_hash: Bytes32) -> ByteArray {
    format_error(
        MessagingChannelError::PayloadHashNotFound,
        format!("Expected hash: {}, Actual hash: {}", expected_hash.value, actual_hash.value),
    )
}
