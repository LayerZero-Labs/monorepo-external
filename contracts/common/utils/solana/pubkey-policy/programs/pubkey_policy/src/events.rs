use anchor_lang::prelude::*;
use pubkey_policy_interface::{Membership, PubkeyPolicyMode};

#[event]
pub struct PubkeyPolicyInitialized {
    pub pubkey_policy: Pubkey,
    pub mint: Pubkey,
    pub admin: Pubkey,
    pub mode: PubkeyPolicyMode,
    pub initializer: Pubkey,
}

#[event]
pub struct MembershipChanged {
    pub pubkey_policy: Pubkey,
    pub mint: Pubkey,
    pub subject: Pubkey,
    pub membership: Membership,
    pub authority: Pubkey,
}

#[event]
pub struct ModeChanged {
    pub pubkey_policy: Pubkey,
    pub mode: PubkeyPolicyMode,
    pub authority: Pubkey,
}
