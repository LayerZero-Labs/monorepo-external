use anchor_lang::prelude::*;

use crate::{errors::OneSigError, state::MerkleRootState};

#[derive(Accounts)]
pub struct CloseMerkleRoot<'info> {
    #[account(mut, address = merkle_root_state.rent_payer @OneSigError::Unauthorized)]
    pub signer: Signer<'info>,
    #[account(
        mut,
        close = signer,
        constraint = merkle_root_state.expiry < Clock::get()?.unix_timestamp @OneSigError::MerkleRootNotExpired,
    )]
    pub merkle_root_state: Account<'info, MerkleRootState>,
}

impl CloseMerkleRoot<'_> {
    pub fn apply(_ctx: &mut Context<CloseMerkleRoot>) -> Result<()> {
        // No additional logic needed for closing the account
        Ok(())
    }
}
