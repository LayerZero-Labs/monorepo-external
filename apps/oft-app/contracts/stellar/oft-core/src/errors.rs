use common_macros::contract_error;

// OFT library error codes: 3000-3099
// See docs/error-spec.md for allocation rules

/// OFTError: 3000-3099
#[contract_error]
pub enum OFTError {
    InvalidAddress = 3000,
    InvalidAmount,
    InvalidLocalDecimals,
    NotInitialized,
    Overflow,
    SlippageExceeded,
}
