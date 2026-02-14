//! Message lib manager errors

use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum MessageLibManagerError {
    /// Triggered when attempting to register a message library that is already registered.
    AlreadyRegistered,
    /// Triggered when the default send library is required but not set.
    DefaultSendLibUnavailable,
    /// Triggered when the default receive library is required but not set.
    DefaultReceiveLibUnavailable,
    /// Triggered when an invalid expiry value is provided.
    InvalidExpiry,
    /// Triggered when a default library is used where a non-default library is required.
    OnlyNonDefaultLib,
    /// Triggered when a library that is not a receive library is used in a receive-only context.
    OnlyReceiveLib,
    /// Triggered when an unregistered library is used.
    OnlyRegisteredLib,
    /// Triggered when a library that is not registered or a default library is used.
    OnlyRegisteredOrDefaultLib,
    /// Triggered when a library that is not a send library is used in a send-only context.
    OnlySendLib,
    /// Triggered when a new value is the same as the current value.
    SameValue,
    /// Triggered when an unsupported endpoint ID is used.
    UnsupportedEid,
}

impl ErrorNameImpl of Error<MessageLibManagerError> {
    fn prefix() -> ByteArray {
        "LZ_MESSAGE_LIB_MANAGER"
    }

    fn name(self: MessageLibManagerError) -> ByteArray {
        match self {
            MessageLibManagerError::AlreadyRegistered => "ALREADY_REGISTERED",
            MessageLibManagerError::DefaultSendLibUnavailable => "DEFAULT_SEND_LIB_UNAVAILABLE",
            MessageLibManagerError::DefaultReceiveLibUnavailable => "DEFAULT_RECEIVE_LIB_UNAVAILABLE",
            MessageLibManagerError::InvalidExpiry => "INVALID_EXPIRY",
            MessageLibManagerError::OnlyNonDefaultLib => "ONLY_NON_DEFAULT_LIB",
            MessageLibManagerError::OnlyReceiveLib => "ONLY_RECEIVE_LIB",
            MessageLibManagerError::OnlyRegisteredLib => "ONLY_REGISTERED_LIB",
            MessageLibManagerError::OnlyRegisteredOrDefaultLib => "ONLY_REGISTERED_OR_DEFAULT_LIB",
            MessageLibManagerError::OnlySendLib => "ONLY_SEND_LIB",
            MessageLibManagerError::SameValue => "SAME_VALUE",
            MessageLibManagerError::UnsupportedEid => "UNSUPPORTED_EID",
        }
    }
}

pub fn err_already_registered() -> ByteArray {
    format_error(MessageLibManagerError::AlreadyRegistered, "")
}

pub fn err_default_send_lib_unavailable() -> ByteArray {
    format_error(MessageLibManagerError::DefaultSendLibUnavailable, "")
}

pub fn err_default_receive_lib_unavailable() -> ByteArray {
    format_error(MessageLibManagerError::DefaultReceiveLibUnavailable, "")
}

pub fn err_invalid_expiry() -> ByteArray {
    format_error(MessageLibManagerError::InvalidExpiry, "")
}

pub fn err_only_non_default_lib() -> ByteArray {
    format_error(MessageLibManagerError::OnlyNonDefaultLib, "")
}

pub fn err_only_receive_lib() -> ByteArray {
    format_error(MessageLibManagerError::OnlyReceiveLib, "")
}

pub fn err_only_registered_lib() -> ByteArray {
    format_error(MessageLibManagerError::OnlyRegisteredLib, "")
}

pub fn err_only_registered_or_default_lib() -> ByteArray {
    format_error(MessageLibManagerError::OnlyRegisteredOrDefaultLib, "")
}

pub fn err_only_send_lib() -> ByteArray {
    format_error(MessageLibManagerError::OnlySendLib, "")
}

pub fn err_same_value() -> ByteArray {
    format_error(MessageLibManagerError::SameValue, "")
}

pub fn err_unsupported_eid(eid: u32) -> ByteArray {
    format_error(MessageLibManagerError::UnsupportedEid, format!("EID: {}", eid))
}
