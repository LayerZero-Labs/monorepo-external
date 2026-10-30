use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum TreasuryError {
    LzTokenNotEnabled,
    TransferFailed,
}

impl ErrorImpl of Error<TreasuryError> {
    fn prefix() -> ByteArray {
        "LZ_TREASURY"
    }

    fn name(self: TreasuryError) -> ByteArray {
        match self {
            TreasuryError::LzTokenNotEnabled => "LZ_TOKEN_NOT_ENABLED",
            TreasuryError::TransferFailed => "LZ_TRANSFER_FAILED",
        }
    }
}

pub fn err_lz_token_not_enabled() -> ByteArray {
    format_error(TreasuryError::LzTokenNotEnabled, "")
}

pub fn err_transfer_failed() -> ByteArray {
    format_error(TreasuryError::TransferFailed, "")
}
