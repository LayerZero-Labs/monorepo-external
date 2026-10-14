use crate::{OFTStore, RateLimitAddressExemption};
use anchor_lang::prelude::*;

/// Returns whether a user address is exempt from rate limiting.
/// EVM alignment: IRateLimiter.isRateLimitAddressExempt(address _user) → bool
///
/// Account existence = exempt. If the exemption PDA has data, user is exempt.
#[derive(Accounts)]
#[instruction(user: Pubkey)]
pub struct IsRateLimitAddressExempt<'info> {
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: PDA seeds validated by Anchor; existence check in handler.
    #[account(
        seeds = RateLimitAddressExemption::seeds(&oft_store.key(), &user),
        bump,
    )]
    pub exemption: UncheckedAccount<'info>,
}

impl IsRateLimitAddressExempt<'_> {
    pub fn apply(ctx: &Context<Self>, _user: &Pubkey) -> Result<bool> {
        Ok(!ctx.accounts.exemption.data_is_empty())
    }
}
