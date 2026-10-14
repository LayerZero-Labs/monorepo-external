use crate::{
    events::RateLimitConfigUpdated, state::RateLimitConfig, OFTStore, RateLimit, RoleMember,
    RoleType,
};
use anchor_lang::prelude::*;

/// Set rate limit config for a specific id.
/// id=0 writes to the default rate-limiter PDA; id>0 writes to the per-EID PDA.
///
/// EVM alignment: RateLimiterRBACUpgradeable.setRateLimitConfigs -
/// onlyRole(RATE_LIMITER_MANAGER_ROLE)
///
/// Note: EVM takes an array for batch updates. On Solana, this instruction handles a single id;
/// for multiple ids, bundle multiple instructions in one transaction.
#[rbac::only_role(role = RoleType::RateLimiterManager, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: SetRateLimitConfigParams)]
pub struct SetRateLimitConfig<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub oft_store: Account<'info, OFTStore>,

    /// RateLimit PDA for `params.id`. id=0 is the default rate limit.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + RateLimit::INIT_SPACE,
        seeds = RateLimit::seeds(&oft_store.key(), params.id),
        bump
    )]
    pub rate_limit: Account<'info, RateLimit>,

    pub system_program: Program<'info, System>,
}

impl SetRateLimitConfig<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &SetRateLimitConfigParams) -> Result<()> {
        ctx.accounts.rate_limit.config = params.config.clone();
        emit_cpi!(RateLimitConfigUpdated {
            oft_store: ctx.accounts.oft_store.key(),
            id: params.id,
            config: params.config.clone()
        });

        Ok(())
    }
}

/// Parameters for setting the rate limit configuration for a specific ID.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetRateLimitConfigParams {
    /// Rate limit ID. 0 for the default config.
    pub id: u128,
    pub config: RateLimitConfig,
}
