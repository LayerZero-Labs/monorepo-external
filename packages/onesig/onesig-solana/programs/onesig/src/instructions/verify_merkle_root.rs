use anchor_lang::prelude::*;

use crate::{
    constants::MERKLE_ROOT_SEED,
    state::{MerkleRootState, OneSigState},
    types::VerifyMerkleRootParams,
    validation::merkle::MerkleValidator,
};

#[derive(Accounts)]
#[instruction(params: VerifyMerkleRootParams)]
pub struct VerifyMerkleRoot<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + MerkleRootState::INIT_SPACE,
        seeds = [MERKLE_ROOT_SEED, one_sig_state.key().as_ref(), params.merkle_root.as_ref()],
        bump,
    )]
    pub merkle_root_state: Account<'info, MerkleRootState>,
    pub one_sig_state: Account<'info, OneSigState>,
    pub system_program: Program<'info, System>,
}

impl VerifyMerkleRoot<'_> {
    pub fn apply(
        ctx: &mut Context<VerifyMerkleRoot>,
        params: &VerifyMerkleRootParams,
    ) -> Result<()> {
        let VerifyMerkleRootParams { merkle_root, expiry, signatures } = params;

        // Verify Merkle root and signatures
        MerkleValidator::verify_merkle_root(
            &ctx.accounts.one_sig_state,
            merkle_root,
            *expiry,
            signatures,
            Clock::get()?.unix_timestamp,
        )?;

        // Store the expiry and seed in the Merkle root state account
        // This allows execute_transaction to ensure the verified merkle root
        // is not expired and the seed is the same as the OneSigState account
        ctx.accounts.merkle_root_state.seed = ctx.accounts.one_sig_state.seed;
        ctx.accounts.merkle_root_state.expiry = *expiry;

        ctx.accounts.merkle_root_state.merkle_root = *merkle_root;
        ctx.accounts.merkle_root_state.rent_payer = ctx.accounts.payer.key();
        ctx.accounts.merkle_root_state.bump = ctx.bumps.merkle_root_state;

        Ok(())
    }
}
