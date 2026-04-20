use common_macros::contract_error;

#[contract_error]
pub enum DvnFeeLibError {
    EidNotSupported,
    InvalidDVNOptions,
    InvalidFee,
    Overflow,
}
