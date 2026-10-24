use common_macros::contract_error;

#[contract_error]
pub enum Uln302Error {
    /// Default executor configuration is not set for the destination endpoint
    DefaultExecutorConfigNotFound,
    /// Default receive ULN configuration is not set for the source endpoint
    DefaultReceiveUlnConfigNotFound,
    /// Default send ULN configuration is not set for the destination endpoint
    DefaultSendUlnConfigNotFound,
    /// Optional DVNs list contains duplicate addresses
    DuplicateOptionalDVNs,
    /// Required DVNs list contains duplicate addresses
    DuplicateRequiredDVNs,
    /// Configuration bytes failed to parse as expected XDR type
    InvalidConfig,
    /// Config type is not one of EXECUTOR, SEND_ULN, or RECEIVE_ULN
    InvalidConfigType,
    /// Confirmations must be zero when using default confirmations
    InvalidConfirmations,
    /// Packet header destination EID does not match this endpoint's EID
    InvalidEID,
    /// Fee returned by a worker or treasury is negative
    InvalidFee,
    /// Message size exceeds executor's configured maximum
    InvalidMessageSize,
    /// Optional DVNs count exceeds maximum allowed (127)
    InvalidOptionalDVNCount,
    /// Optional DVNs must be empty when using default optional DVNs
    InvalidOptionalDVNs,
    /// Optional DVN threshold is invalid (must be 0 with no DVNs, or 1 to DVN count)
    InvalidOptionalDVNThreshold,
    /// Required DVNs count exceeds maximum allowed (127)
    InvalidRequiredDVNCount,
    /// Required DVNs must be empty when using default required DVNs
    InvalidRequiredDVNs,
    /// Sender address must be a contract (C-address), not an account (G-address)
    InvalidSenderAddress,
    /// Configuration must have at least one DVN (required or optional with threshold > 0)
    UlnAtLeastOneDVN,
    /// Endpoint ID is not supported (missing default configurations)
    UnsupportedEid,
    /// Message has not been verified by enough DVNs yet
    Verifying,
    /// Executor max message size cannot be zero
    ZeroMessageSize,
}
