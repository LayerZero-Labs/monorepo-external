//! AllowList errors

use lz_utils::error::{Error, format_error};
use starknet::ContractAddress;

/// An allow list error
#[derive(Drop)]
pub enum AllowlistError {
    /// User is not allowlisted under the current mode.
    NotAllowlisted,
}

impl ErrorNameImpl of Error<AllowlistError> {
    fn prefix() -> ByteArray {
        "LZ_OAPP_ALLOWLIST"
    }

    fn name(self: AllowlistError) -> ByteArray {
        match self {
            AllowlistError::NotAllowlisted => "NOT_ALLOWLISTED",
        }
    }
}

pub fn err_not_allowlisted(user: ContractAddress) -> ByteArray {
    format_error(AllowlistError::NotAllowlisted, format!("user: {:?}", user))
}

/// Simple error for allowlist checks without detailed context
pub fn err_not_allowed() -> ByteArray {
    format_error(AllowlistError::NotAllowlisted, "")
}

