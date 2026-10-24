use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum FeeError {
    InvalidBps,
    InvalidFeeOwner,
}

impl ErrorNameImpl of Error<FeeError> {
    fn prefix() -> ByteArray {
        "LZ_OAPP_FEE"
    }

    fn name(self: FeeError) -> ByteArray {
        match self {
            FeeError::InvalidBps => "INVALID_BPS",
            FeeError::InvalidFeeOwner => "INVALID_FEE_OWNER",
        }
    }
}

pub fn err_invalid_bps(bps: u16) -> ByteArray {
    format_error(FeeError::InvalidBps, format!("bps: {}", bps))
}

pub fn err_invalid_fee_owner() -> ByteArray {
    format_error(FeeError::InvalidFeeOwner, "")
}
