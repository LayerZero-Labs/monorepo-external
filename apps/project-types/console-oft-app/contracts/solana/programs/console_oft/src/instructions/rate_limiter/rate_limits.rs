use crate::{state::RateLimit, OFTStore};
use anchor_lang::prelude::*;
use oapp::utils::try_load_account;

/// Accounts for `rate_limits`: reads only the RateLimit PDA for the requested id.
#[derive(Accounts)]
#[instruction(id: u128)]
pub struct RateLimits<'info> {
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: Per-EID RateLimit PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Returns None when the PDA is uninitialized.
    #[account(
        seeds = RateLimit::seeds(&oft_store.key(), id),
        bump,
    )]
    pub rate_limit: UncheckedAccount<'info>,
}

impl RateLimits<'_> {
    /// Returns the rate limit config + state for a given id.
    /// id=0 returns the default RateLimit PDA; id>0 loads the
    /// per-EID PDA (None when uninitialized).
    /// EVM alignment: IRateLimiter.rateLimits(uint256 _id) → RateLimit
    /// Solana-specific: returns `Option<RateLimit>` instead of a zero-initialized
    /// struct so callers can distinguish "never set" from a config of all zeros.
    pub fn rate_limits(ctx: &Context<Self>, _id: &u128) -> Result<Option<RateLimit>> {
        try_load_account(&ctx.accounts.rate_limit)
    }
}
