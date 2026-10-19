//! Simple message library errors

use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum SimpleMessageLibError {
    OnlyWhitelistCaller,
}

impl ErrorNameImpl of Error<SimpleMessageLibError> {
    fn prefix() -> ByteArray {
        "LZ_SIMPLE_MESSAGE_LIB"
    }

    fn name(self: SimpleMessageLibError) -> ByteArray {
        match self {
            SimpleMessageLibError::OnlyWhitelistCaller => "ONLY_WHITELIST_CALLER",
        }
    }
}
pub fn err_only_whitelist_caller() -> ByteArray {
    format_error(SimpleMessageLibError::OnlyWhitelistCaller, "")
}
