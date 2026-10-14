use crate::{
    serialize_into_owned_unchecked_account, state, OFTError, OFTStore, RateLimit, RoleMember,
    RoleType, DEFAULT_RATE_LIMIT_ID,
};
use anchor_lang::prelude::*;
use oapp::utils::try_load_account;

/// Checkpoints decayed rate limit usages into state for a given id.
/// EVM alignment: IRateLimiter.checkpointRateLimits(uint256[] calldata _ids)
/// On Solana, handles a single id per instruction.
#[rbac::only_role(role = RoleType::RateLimiterManager, state = oft_store, authority = authority)]
#[derive(Accounts)]
#[instruction(id: u128)]
pub struct CheckpointRateLimit<'info> {
    pub authority: Signer<'info>,

    pub oft_store: Account<'info, OFTStore>,

    /// Default RateLimit PDA (id=0).
    #[account(
        mut,
        seeds = RateLimit::seeds(&oft_store.key(), DEFAULT_RATE_LIMIT_ID),
        bump
    )]
    pub default_rate_limit: Account<'info, RateLimit>,

    /// Per-EID RateLimit PDA. Ignored when `id == 0` or global state is enabled.
    /// CHECK: Loaded manually with `try_load_account`; write-back is handled separately.
    #[account(
        mut,
        seeds = RateLimit::seeds(&oft_store.key(), id),
        bump
    )]
    pub rate_limit: UncheckedAccount<'info>,
}

impl CheckpointRateLimit<'_> {
    pub fn apply(ctx: &mut Context<Self>, id: &u128) -> Result<()> {
        let checkpoint_default = id == &DEFAULT_RATE_LIMIT_ID;
        if ctx.accounts.oft_store.use_global_state || checkpoint_default {
            let config = ctx.accounts.default_rate_limit.config.clone();
            Self::checkpoint_state(&mut ctx.accounts.default_rate_limit.state, &config)?;
            return Ok(());
        }

        let mut rate_limit: RateLimit =
            try_load_account(&ctx.accounts.rate_limit)?.ok_or(OFTError::RateLimitNotInitialized)?;
        let config = if rate_limit.config.override_default_config {
            rate_limit.config.clone()
        } else {
            ctx.accounts.default_rate_limit.config.clone()
        };
        Self::checkpoint_state(&mut rate_limit.state, &config)?;
        serialize_into_owned_unchecked_account(&ctx.accounts.rate_limit, Some(&rate_limit))?;
        Ok(())
    }

    fn checkpoint_state(
        rate_limit_state: &mut state::RateLimitState,
        config: &state::RateLimitConfig,
    ) -> Result<()> {
        let now = state::now()?;
        let usages = state::compute_rate_limit_usages_at(rate_limit_state, config, now)?;
        rate_limit_state.outbound_usage = usages.outbound_usage;
        rate_limit_state.inbound_usage = usages.inbound_usage;
        rate_limit_state.last_updated = now;
        Ok(())
    }
}
