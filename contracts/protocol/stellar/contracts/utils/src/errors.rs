use common_macros::contract_error;

// Utils library error codes: 1000-1099
// See docs/error-spec.md for allocation rules

/// BufferReaderError: 1000-1009
#[contract_error]
pub enum BufferReaderError {
    InvalidLength = 1000,
    InvalidAddressPayload,
}

/// BufferWriterError: 1010-1019
#[contract_error]
pub enum BufferWriterError {
    InvalidAddressPayload = 1010,
}

/// TtlConfigurableError: 1020-1029
#[contract_error]
pub enum TtlConfigurableError {
    InvalidTtlConfig = 1020,
    TtlConfigFrozen,
    TtlConfigAlreadyFrozen,
}

/// OwnableError: 1030-1039
#[contract_error]
pub enum OwnableError {
    InvalidAuthorizer = 1030,
    InvalidPendingOwner,
    InvalidTtl,
    NoPendingTransfer,
    OwnerAlreadySet,
    OwnerNotSet,
    TransferInProgress,
}

/// BytesExtError: 1040-1049
#[contract_error]
pub enum BytesExtError {
    LengthMismatch = 1040,
}

/// UpgradeableError: 1050-1059
#[contract_error]
pub enum UpgradeableError {
    InvalidMigrationData = 1050,
    MigrationNotAllowed,
}

/// MultiSigError: 1060-1069
#[contract_error]
pub enum MultiSigError {
    AlreadyInitialized = 1060,
    InvalidAuthorizer,
    InvalidSigner,
    SignatureError,
    SignerAlreadyExists,
    SignerNotFound,
    TotalSignersLessThanThreshold,
    UnsortedSigners,
    ZeroThreshold,
}

/// AuthError: 1070-1079
#[contract_error]
pub enum AuthError {
    AuthorizerNotFound = 1070,
}

/// RbacError: 1080-1089
#[contract_error]
pub enum RbacError {
    AdminRoleNotFound = 1080,
    IndexOutOfBounds,
    MaxRolesExceeded,
    RoleIsEmpty,
    RoleNotFound,
    RoleNotHeld,
    Unauthorized,
}
