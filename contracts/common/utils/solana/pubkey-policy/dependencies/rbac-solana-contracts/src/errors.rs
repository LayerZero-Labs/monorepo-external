use anchor_lang::prelude::error_code;

/// RBAC error codes.
/// EVM alignment: OpenZeppelin AccessControl errors
#[error_code]
pub enum RbacError {
    /// The caller of accept_default_admin_transfer must be the pending default admin.
    /// EVM: acceptDefaultAdminTransfer
    #[msg("Caller is not the pending admin")]
    CallerNotPendingAdmin,

    /// Cannot grant DEFAULT_ADMIN_ROLE directly.
    /// Must use begin_default_admin_transfer + accept_default_admin_transfer 2-step flow.
    /// EVM: AccessControlEnforcedDefaultAdminRules
    #[msg("DefaultAdmin can only be transferred via begin_default_admin_transfer")]
    DefaultAdminNotGrantable,

    /// Cannot renounce DEFAULT_ADMIN_ROLE.
    /// There must always be exactly one DefaultAdmin.
    /// EVM: AccessControlEnforcedDefaultAdminRules
    #[msg("DefaultAdmin can not be renounced")]
    DefaultAdminNotRenounceable,

    /// Cannot revoke DEFAULT_ADMIN_ROLE directly.
    /// Must use begin_default_admin_transfer + accept_default_admin_transfer 2-step flow.
    /// EVM: AccessControlEnforcedDefaultAdminRules
    #[msg("DefaultAdmin can only be transferred via begin_default_admin_transfer")]
    DefaultAdminNotRevocable,

    #[msg("DefaultAdmin already initialized")]
    DefaultAdminAlreadyInitialized,

    /// EVM: InvalidDefaultAdmin(address defaultAdmin)
    #[msg("Invalid default admin")]
    InvalidDefaultAdmin,

    /// The new admin is the same as the current default admin.
    #[msg("New admin must differ from the current default admin")]
    NewAdminIsSameAsCurrent,

    /// Caller is not authorized (e.g. not the current default admin).
    /// EVM: OwnableUnauthorizedAccount(address account)
    #[msg("Unauthorized")]
    Unauthorized,
}
