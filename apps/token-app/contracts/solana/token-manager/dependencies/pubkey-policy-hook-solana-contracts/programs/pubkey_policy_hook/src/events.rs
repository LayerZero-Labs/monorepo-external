use anchor_lang::prelude::*;

#[event]
pub struct TransferHookInitialized {
    pub mint: Pubkey,
    pub pubkey_policy: Pubkey,
    pub authority: Pubkey,
}
