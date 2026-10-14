use crate::{state::RateLimitGlobalConfig, OFTStore};
use anchor_lang::prelude::*;
use oft::types::OftType;

/// Shared accounts struct for all read-only OFTStore view instructions.
#[derive(Accounts)]
pub struct OftStoreView<'info> {
    pub oft_store: Account<'info, OFTStore>,
}

impl OftStoreView<'_> {
    pub fn oft_type(ctx: &Context<Self>) -> Result<OftType> {
        Ok(ctx.accounts.oft_store.oft_type.clone())
    }

    pub fn default_fee_bps(ctx: &Context<Self>) -> Result<u16> {
        Ok(ctx.accounts.oft_store.default_fee_bps)
    }

    pub fn fee_deposit(ctx: &Context<Self>) -> Result<Pubkey> {
        Ok(ctx.accounts.oft_store.fee_deposit)
    }

    pub fn default_paused(ctx: &Context<Self>) -> Result<bool> {
        Ok(ctx.accounts.oft_store.default_paused)
    }

    pub fn shared_decimals(ctx: &Context<Self>) -> Result<u8> {
        Ok(ctx.accounts.oft_store.shared_decimals)
    }

    pub fn token(ctx: &Context<Self>) -> Result<Pubkey> {
        Ok(ctx.accounts.oft_store.token_mint)
    }

    pub fn transfer_hook_program(ctx: &Context<Self>) -> Result<Pubkey> {
        Ok(ctx.accounts.oft_store.transfer_hook_program)
    }

    pub fn get_rate_limit_global_config(ctx: &Context<Self>) -> Result<RateLimitGlobalConfig> {
        let s = &ctx.accounts.oft_store;
        Ok(RateLimitGlobalConfig {
            use_global_state: s.use_global_state,
            is_globally_disabled: s.is_globally_disabled,
        })
    }
}
