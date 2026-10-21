use anchor_lang::prelude::*;

/// Return type for the `get_default_admin` view instruction.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct DefaultAdminInfo {
    /// The current default admin.
    pub current: Pubkey,
    /// The pending default admin.
    pub pending: Pubkey,
}

/// Parameters for granting a role.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct GrantRoleParams<Role> {
    /// The role to grant.
    pub role: Role,
    /// The account to grant the role to.
    pub account: Pubkey,
}

/// Parameters for revoking a role.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RevokeRoleParams<Role> {
    /// The role to revoke.
    pub role: Role,
    /// The account to revoke the role from.
    pub account: Pubkey,
}

/// Parameters for renouncing a role.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct RenounceRoleParams<Role> {
    /// The role to renounce.
    pub role: Role,
}
