//! OmniCounter errors

use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum OmniCounterError {
    /// Triggered when someone other than admin tries to access admin functions
    OnlyAdmin,
    /// Triggered when withdraw operation fails
    WithdrawFailed,
    /// Triggered when value sent is insufficient compared to the required value
    InsufficientValue,
    /// Triggered when an invalid message type is received
    InvalidMessageType,
    /// Triggered when the compose source is not the OApp itself
    NotOApp,
    /// Triggered when the caller is not the endpoint
    NotEndpoint,
    /// Triggered when an invalid nonce is received in ordered mode
    InvalidNonce,
    /// Triggered when array lengths don't match in batch operations
    LengthMismatch,
    /// Triggered when there's not enough native fee for operations
    NotEnoughNative,
}

impl ErrorNameImpl of Error<OmniCounterError> {
    fn prefix() -> ByteArray {
        "LZ_OMNI_COUNTER"
    }

    fn name(self: OmniCounterError) -> ByteArray {
        match self {
            OmniCounterError::OnlyAdmin => "ONLY_ADMIN",
            OmniCounterError::WithdrawFailed => "WITHDRAW_FAILED",
            OmniCounterError::InsufficientValue => "INSUFFICIENT_VALUE",
            OmniCounterError::InvalidMessageType => "INVALID_MESSAGE_TYPE",
            OmniCounterError::NotOApp => "NOT_OAPP",
            OmniCounterError::NotEndpoint => "NOT_ENDPOINT",
            OmniCounterError::InvalidNonce => "INVALID_NONCE",
            OmniCounterError::LengthMismatch => "LENGTH_MISMATCH",
            OmniCounterError::NotEnoughNative => "NOT_ENOUGH_NATIVE",
        }
    }
}

pub fn err_only_admin() -> ByteArray {
    format_error(OmniCounterError::OnlyAdmin, "")
}

pub fn err_withdraw_failed() -> ByteArray {
    format_error(OmniCounterError::WithdrawFailed, "")
}

pub fn err_insufficient_value(required: u256, provided: u256) -> ByteArray {
    format_error(
        OmniCounterError::InsufficientValue,
        format!("required: {}, provided: {}", required, provided),
    )
}

pub fn err_invalid_message_type(msg_type: u8) -> ByteArray {
    format_error(OmniCounterError::InvalidMessageType, format!("type: {}", msg_type))
}

pub fn err_not_oapp() -> ByteArray {
    format_error(OmniCounterError::NotOApp, "")
}

pub fn err_not_endpoint() -> ByteArray {
    format_error(OmniCounterError::NotEndpoint, "")
}

pub fn err_invalid_nonce(expected: u64, received: u64) -> ByteArray {
    format_error(
        OmniCounterError::InvalidNonce, format!("expected: {}, received: {}", expected, received),
    )
}

pub fn err_length_mismatch() -> ByteArray {
    format_error(OmniCounterError::LengthMismatch, "")
}

pub fn err_not_enough_native(msg_value: u256) -> ByteArray {
    format_error(OmniCounterError::NotEnoughNative, format!("msg.value: {}", msg_value))
}
