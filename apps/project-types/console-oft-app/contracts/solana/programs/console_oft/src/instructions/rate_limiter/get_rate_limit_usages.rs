use crate::{
    state::{self, RateLimit, RateLimitUsages},
    OFTStore, DEFAULT_RATE_LIMIT_ID,
};
use anchor_lang::prelude::*;
use oapp::utils::try_load_account;

/// Accounts for `get_rate_limit_usages`: the default RateLimit PDA is needed for
/// fallback config / global-state resolution, alongside the per-id PDA.
#[derive(Accounts)]
#[instruction(id: u128)]
pub struct GetRateLimitUsages<'info> {
    pub oft_store: Account<'info, OFTStore>,

    #[account(
        seeds = RateLimit::seeds(&oft_store.key(), DEFAULT_RATE_LIMIT_ID),
        bump,
    )]
    pub default_rate_limit: Account<'info, RateLimit>,

    /// CHECK: Per-EID RateLimit PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Returns None when the PDA is uninitialized.
    #[account(
        seeds = RateLimit::seeds(&oft_store.key(), id),
        bump,
    )]
    pub rate_limit: UncheckedAccount<'info>,
}

impl GetRateLimitUsages<'_> {
    /// Returns the current decayed rate limit usages and available capacities for a given id.
    /// EVM alignment: IRateLimiter.getRateLimitUsages(uint256 _id) →
    ///     (uint256 outboundUsage, uint256 outboundAvailableAmount, uint256 inboundUsage, uint256
    /// inboundAvailableAmount)
    /// id=0 always reads the default RateLimit PDA (mirrors EVM `rateLimits[0]`),
    /// regardless of `use_global_state`.
    pub fn get_rate_limit_usages(ctx: &Context<Self>, _id: &u128) -> Result<RateLimitUsages> {
        let rate_limit: Option<RateLimit> = try_load_account(&ctx.accounts.rate_limit)?;
        state::get_rate_limit_usages(
            &ctx.accounts.oft_store,
            &ctx.accounts.default_rate_limit,
            rate_limit.as_ref(),
        )
    }
}
