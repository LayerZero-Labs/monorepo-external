use anchor_lang::prelude::*;

/// Emitted when a role is granted to an account.
/// EVM alignment: AccessControl.RoleGranted(bytes32 role, address account, address sender)
///
/// `state` is the state-account PDA whose RBAC table this role belongs to.
/// A single Solana program can host many independent state instances (e.g.
/// an OFT program manages many OFTStores, mirroring how the SPL Token program
/// manages many `Mint` accounts), so the event carries the state pubkey to let
/// off-chain consumers attribute each grant to the right instance.
#[event]
pub struct RoleGranted {
    pub state: Pubkey,
    pub role: u8,
    pub account: Pubkey,
    /// The operator who initiated the grant (named `sender` for EVM parity).
    pub sender: Pubkey,
}

/// Emitted when a role is revoked from an account.
/// EVM alignment: AccessControl.RoleRevoked(bytes32 role, address account, address sender)
///
/// See [`RoleGranted`] for the rationale of the `state` field.
#[event]
pub struct RoleRevoked {
    pub state: Pubkey,
    pub role: u8,
    pub account: Pubkey,
    /// The operator who initiated the revoke (named `sender` for EVM parity).
    pub sender: Pubkey,
}

/// Emitted when a default admin transfer is started.
/// EVM alignment: AccessControl2StepUpgradeable.DefaultAdminTransferStarted(address newAdmin)
///
/// See [`RoleGranted`] for the rationale of the `state` field.
#[event]
pub struct DefaultAdminTransferStarted {
    pub state: Pubkey,
    pub new_admin: Pubkey,
}
