use crate::{
    events::RateLimitStateUpdated,
    state::{now, RateLimitState},
    OFTError, OFTStore, RateLimit, RoleMember, RoleType,
};
use anchor_lang::prelude::*;

/// Set rate limit state for manual correction/recovery.
/// id=0 writes to the default rate-limiter PDA; id>0 writes to the per-EID PDA.
///
/// EVM alignment: RateLimiterRBACUpgradeable.setRateLimitStates -
/// onlyRole(RATE_LIMITER_MANAGER_ROLE)
///
/// This is an escape hatch for correcting rate limit state in case of:
/// - Bug recovery
/// - Migration
/// - Emergency reset
///
/// Note: EVM takes an array for batch updates. On Solana, this instruction handles a single id;
/// for multiple ids, bundle multiple instructions in one transaction.
#[rbac::only_role(role = RoleType::RateLimiterManager, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: SetRateLimitStateParams)]
pub struct SetRateLimitState<'info> {
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

impl SetRateLimitState<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &SetRateLimitStateParams) -> Result<()> {
        let current_time: u64 = now()?;
        require!(params.state.last_updated <= current_time, OFTError::LastUpdatedInFuture);

        ctx.accounts.rate_limit.state = params.state.clone();

        emit_cpi!(RateLimitStateUpdated {
            oft_store: ctx.accounts.oft_store.key(),
            id: params.id,
            state: params.state.clone()
        });

        Ok(())
    }
}

/// Parameters for manually setting rate limit state (recovery/correction).
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetRateLimitStateParams {
    /// Rate limit ID. 0 for the default state.
    pub id: u128,
    pub state: RateLimitState,
}
