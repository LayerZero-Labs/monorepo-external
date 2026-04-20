use common_macros::contract_error;

// OApp library error codes: 2000-2099
// See docs/error-spec.md for allocation rules

/// OAppError: 2000-2099
#[contract_error]
pub enum OAppError {
    InvalidOptions = 2000,
    NoPeer,
    OnlyPeer,
    ZroTokenUnavailable,
}
