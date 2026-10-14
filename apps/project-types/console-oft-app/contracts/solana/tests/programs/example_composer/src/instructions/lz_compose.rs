use crate::{ComposerError, ComposerStore, COMPOSER_SEED};
use anchor_lang::prelude::*;
use oapp::{
    endpoint::{types::ClearComposeParams, ID as ENDPOINT_ID},
    endpoint_cpi::clear_compose,
    types::LzComposeParams,
};

#[derive(Accounts)]
#[instruction(params: LzComposeParams)]
pub struct LzCompose<'info> {
    #[account(
        mut,
        seeds = [COMPOSER_SEED],
        bump = composer_store.bump,
        constraint = composer_store.key() == params.to,
        // Anyone can queue a compose message; only the OFT this composer serves is trusted.
        constraint = composer_store.oft_store == params.from @ ComposerError::UntrustedSender,
    )]
    pub composer_store: Account<'info, ComposerStore>,
}

impl LzCompose<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &LzComposeParams) -> Result<()> {
        msg!("Compose received: from={}, to={}", params.from, params.to);

        clear_compose(
            ENDPOINT_ID,
            ctx.accounts.composer_store.key(),
            ctx.remaining_accounts,
            &ctx.accounts.composer_store.signer_seeds(),
            ClearComposeParams {
                from: params.from,
                guid: params.guid,
                index: params.index,
                message: params.message.clone(),
            },
        )?;

        ctx.accounts.composer_store.compose_count += 1;
        msg!("Compose cleared, count={}", ctx.accounts.composer_store.compose_count);

        Ok(())
    }
}
