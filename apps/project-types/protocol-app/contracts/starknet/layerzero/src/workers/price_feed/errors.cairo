use lz_utils::error::{Error, format_error};

#[derive(Drop)]
pub enum PriceFeedError {
    OnlyPriceUpdater,
    NotAnOpStack,
    PriceRatioDenominatorZero,
    TransferFailed,
}

impl ErrorNameImpl of Error<PriceFeedError> {
    fn prefix() -> ByteArray {
        "LZ_PRICE_FEED"
    }

    fn name(self: PriceFeedError) -> ByteArray {
        match self {
            PriceFeedError::OnlyPriceUpdater => "ONLY_PRICE_UPDATER",
            PriceFeedError::NotAnOpStack => "NOT_AN_OP_STACK",
            PriceFeedError::PriceRatioDenominatorZero => "PRICE_RATIO_DENOMINATOR_ZERO",
            PriceFeedError::TransferFailed => "TRANSFER_FAILED",
        }
    }
}

pub fn err_lz_price_feed_only_price_updater() -> ByteArray {
    format_error(PriceFeedError::OnlyPriceUpdater, "")
}

pub fn err_lz_pricefeed_not_an_op_stack() -> ByteArray {
    format_error(PriceFeedError::NotAnOpStack, "")
}

pub fn err_price_ratio_denominator_zero() -> ByteArray {
    format_error(PriceFeedError::PriceRatioDenominatorZero, "")
}

pub fn err_transfer_failed() -> ByteArray {
    format_error(PriceFeedError::TransferFailed, "")
}
