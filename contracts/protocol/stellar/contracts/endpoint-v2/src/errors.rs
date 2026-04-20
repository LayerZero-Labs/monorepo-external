use common_macros::contract_error;

#[contract_error]
pub enum EndpointError {
    /// Library is already registered with the endpoint
    AlreadyRegistered,
    /// Compose message already exists for this GUID and index
    ComposeExists,
    /// Compose message not found for the given GUID and index
    ComposeNotFound,
    /// Default receive library is not set for the source endpoint
    DefaultReceiveLibUnavailable,
    /// Default send library is not set for the destination endpoint
    DefaultSendLibUnavailable,
    /// Supplied native token fee is less than required
    InsufficientNativeFee,
    /// Supplied ZRO token fee is less than required
    InsufficientZroFee,
    /// Timeout expiry is invalid (already expired)
    InvalidExpiry,
    /// Amount is invalid (negative)
    InvalidAmount,
    /// Compose index exceeds maximum allowed value
    InvalidIndex,
    /// Nonce is invalid for the requested operation
    InvalidNonce,
    /// Payload hash is invalid (empty hash not allowed)
    InvalidPayloadHash,
    /// Receive library is not valid for the receiver and source endpoint
    InvalidReceiveLibrary,
    /// Operation requires a non-default (custom) library
    OnlyNonDefaultLib,
    /// Library must support receiving messages
    OnlyReceiveLib,
    /// Library must be registered with the endpoint
    OnlyRegisteredLib,
    /// Library must support sending messages
    OnlySendLib,
    /// Messaging path cannot be initialized for the given origin
    PathNotInitializable,
    /// Message cannot be verified for the given origin
    PathNotVerifiable,
    /// Payload hash does not match the stored hash
    PayloadHashNotFound,
    /// New value is the same as existing value
    SameValue,
    /// Caller is not authorized (not OApp or delegate)
    Unauthorized,
    /// Endpoint ID is not supported by the library
    UnsupportedEid,
    /// ZRO fee must be greater than zero when pay_in_zro is true
    ZeroZroFee,
    /// ZRO token address is not set
    ZroUnavailable,
}
