use common_macros::contract_error;

#[contract_error]
pub enum DvnError {
    AuthDataExpired,
    EidNotSupported,
    HashAlreadyUsed,
    InvalidAuthContext,
    InvalidUpgradeContext,
    InvalidVid,
    NonContractInvoke,
    OnlyAdmin,
    UpgraderNotSet,
}
