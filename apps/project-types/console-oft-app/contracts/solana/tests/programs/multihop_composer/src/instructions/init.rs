use crate::{ComposerStore, PlannedAccount, COMPOSER_SEED};
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitParams {
    pub token_mint: Pubkey,
    pub oft_store: Pubkey,
    pub fee_deposit: Pubkey,
    pub token_manager: Pubkey,
    pub send_library_program: Pubkey,
    pub send_library_tail: Vec<PlannedAccount>,
}

#[derive(Accounts)]
pub struct Init<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + ComposerStore::INIT_SPACE,
        seeds = [COMPOSER_SEED],
        bump,
    )]
    pub composer_store: Account<'info, ComposerStore>,

    pub system_program: Program<'info, System>,
}

impl Init<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: InitParams) -> Result<()> {
        ctx.accounts.composer_store.set_inner(ComposerStore {
            token_mint: params.token_mint,
            oft_store: params.oft_store,
            fee_deposit: params.fee_deposit,
            token_manager: params.token_manager,
            send_library_program: params.send_library_program,
            send_library_tail: params.send_library_tail,
            bump: ctx.bumps.composer_store,
        });
        Ok(())
    }
}
