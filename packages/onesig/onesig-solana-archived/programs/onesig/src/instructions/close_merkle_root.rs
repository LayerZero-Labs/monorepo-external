use anchor_lang::prelude::*;

use crate::{
    constants::MERKLE_ROOT_SEED,
    errors::OneSigError,
    state::{MerkleRootState, OneSigState},
};

/// Permissionless close of a dead `MerkleRootState`: anyone can reclaim the PDA slot, with rent
/// refunded to the recorded `rent_payer`.
#[derive(Accounts)]
pub struct CloseMerkleRoot<'info> {
    /// CHECK: Refund target only. Constrained to equal the recorded `rent_payer`, so the
    /// reclaimed rent cannot be redirected.
    #[account(mut, address = merkle_root_state.rent_payer @OneSigError::InvalidRentPayer)]
    pub rent_payer: UncheckedAccount<'info>,
    #[account(
        mut,
        // Bind the root PDA to this OneSigState before evaluating seed mismatch.
        seeds = [MERKLE_ROOT_SEED, one_sig_state.key().as_ref(), merkle_root_state.merkle_root.as_ref()],
        bump = merkle_root_state.bump,
        close = rent_payer,
        // Dead when expired, or when the stored seed no longer matches state (so it can never
        // pass the `execute_transaction` seed gate).
        constraint = (merkle_root_state.expiry < Clock::get()?.unix_timestamp
            || merkle_root_state.seed != one_sig_state.seed) @OneSigError::MerkleRootNotCloseable,
    )]
    pub merkle_root_state: Account<'info, MerkleRootState>,
    pub one_sig_state: Account<'info, OneSigState>,
}

impl CloseMerkleRoot<'_> {
    pub fn apply(_ctx: &mut Context<CloseMerkleRoot>) -> Result<()> {
        // No additional logic needed for closing the account
        Ok(())
    }
}
