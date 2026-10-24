//! OFT errors

use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum OFTCoreError {
    InvalidLocalDecimals,
    SlippageExceeded,
    AmountSDOverflowed,
    OFTTransferFailed,
}

impl ErrorNameImpl of Error<OFTCoreError> {
    fn prefix() -> ByteArray {
        "LZ_OFT_CORE"
    }

    fn name(self: OFTCoreError) -> ByteArray {
        match self {
            OFTCoreError::InvalidLocalDecimals => "INVALID_LOCAL_DECIMALS",
            OFTCoreError::SlippageExceeded => "SLIPPAGE_EXCEEDED",
            OFTCoreError::AmountSDOverflowed => "AMOUNT_SD_OVERFLOWED",
            OFTCoreError::OFTTransferFailed => "OFT_TRANSFER_FAILED",
        }
    }
}

pub fn err_invalid_local_decimals(local_decimals: u8, shared_decimals: u8) -> ByteArray {
    format_error(
        OFTCoreError::InvalidLocalDecimals,
        format!("local_decimals: {}, shared_decimals: {}", local_decimals, shared_decimals),
    )
}

pub fn err_slippage_exceeded(amount_received_ld: u256, min_amount_ld: u256) -> ByteArray {
    format_error(
        OFTCoreError::SlippageExceeded,
        format!("amount_received_ld: {}, min_amount_ld: {}", amount_received_ld, min_amount_ld),
    )
}

pub fn err_amount_sd_overflowed(amount_sd: u256) -> ByteArray {
    format_error(OFTCoreError::AmountSDOverflowed, format!("amount_sd: {}", amount_sd))
}

pub fn err_oft_transfer_failed() -> ByteArray {
    format_error(OFTCoreError::OFTTransferFailed, "")
}
