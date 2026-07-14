use common_macros::contract_error;

#[contract_error]
pub enum CounterError {
    OAppInvalidNonce,
    InvalidMsgValue,
    InsufficientValue,
    InvalidMsgType,
}
