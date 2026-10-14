use crate::{events::RateLimitGlobalConfigUpdated, OFTStore, RoleMember, RoleType};
use anchor_lang::prelude::*;

/// Set rate limit global configuration (use_global_state, is_globally_disabled).
/// EVM alignment: RateLimiterRBACUpgradeable.setRateLimitGlobalConfig -
/// onlyRole(RATE_LIMITER_MANAGER_ROLE)
#[rbac::only_role(role = RoleType::RateLimiterManager, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct SetRateLimitGlobalConfig<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,
}

impl SetRateLimitGlobalConfig<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &SetRateLimitGlobalConfigParams) -> Result<()> {
        let oft_store = &mut ctx.accounts.oft_store;
        oft_store.use_global_state = params.use_global_state;
        oft_store.is_globally_disabled = params.is_globally_disabled;

        emit_cpi!(RateLimitGlobalConfigUpdated {
            oft_store: oft_store.key(),
            use_global_state: params.use_global_state,
            is_globally_disabled: params.is_globally_disabled,
        });

        Ok(())
    }
}

/// Parameters for setting the global rate limiter configuration.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetRateLimitGlobalConfigParams {
    /// Whether to use global state for the rate limiter, instead of per-ID rules.
    pub use_global_state: bool,
    /// Whether the rate limiter is globally disabled.
    pub is_globally_disabled: bool,
}
