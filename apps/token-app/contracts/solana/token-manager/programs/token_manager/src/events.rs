use anchor_lang::prelude::*;

#[event]
pub struct PermissionedBurnApproved {
    pub token_manager: Pubkey,
    pub token_account: Pubkey,
    pub source_authority: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
}

#[event]
pub struct TokenManagerStoreInitialized {
    pub token_manager: Pubkey,
    pub mint: Pubkey,
    pub bootstrap: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct PendingAdminSet {
    pub token_manager: Pubkey,
    pub pending_admin: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct TransferHookPolicySet {
    pub token_manager: Pubkey,
    pub pubkey_policy: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct NativeAuthorityChanged {
    pub token_manager: Pubkey,
    pub kind: u8,
    pub new_authority: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct AclInitialized {
    pub token_manager: Pubkey,
    pub pubkey_policy: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct TokenAccountStateChanged {
    pub token_manager: Pubkey,
    pub token_account: Pubkey,
    pub frozen: bool,
    pub authority: Pubkey,
}

#[event]
pub struct AclPermissionsChanged {
    pub token_manager: Pubkey,
    pub freeze_enabled: bool,
    pub thaw_enabled: bool,
    pub authority: Pubkey,
}

#[event]
pub struct AclGatingProgramChanged {
    pub token_manager: Pubkey,
    pub gating_program: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct PermanentDelegateBurned {
    pub token_manager: Pubkey,
    pub token_account: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
}

#[event]
pub struct FundsRecovered {
    pub token_manager: Pubkey,
    pub source: Pubkey,
    pub destination: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
}

#[event]
pub struct PauseStateChanged {
    pub token_manager: Pubkey,
    pub paused: bool,
    pub authority: Pubkey,
}

#[event]
pub struct TokensMinted {
    pub token_manager: Pubkey,
    pub token_account: Pubkey,
    pub amount: u64,
    pub authority: Pubkey,
}
