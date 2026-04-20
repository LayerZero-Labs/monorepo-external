use common_macros::contract_error;

// Worker library error codes: 1200-1299
// See docs/error-spec.md for allocation rules

/// WorkerError: 1200-1299
#[contract_error]
pub enum WorkerError {
    AdminAlreadyExists = 1200,
    AdminNotFound,
    AlreadyOnAllowlist,
    AlreadyOnDenylist,
    DepositAddressNotSet,
    MessageLibAlreadySupported,
    MessageLibNotSupported,
    NotAllowed,
    NotOnAllowlist,
    NotOnDenylist,
    PauseStatusUnchanged,
    PriceFeedNotSet,
    Unauthorized,
    UnsupportedMessageLib,
    WorkerFeeLibNotSet,
    WorkerIsPaused,
}
