use crate::{
    errors::OFTError, events::RateLimitAddressExemptionUpdated, OFTStore,
    RateLimitAddressExemption, RoleMember, RoleType,
};
use anchor_lang::prelude::*;

/// Create/remove rate limit address exemption PDA for a user.
/// EVM alignment: RateLimiterRBACUpgradeable.setRateLimitAddressExemptions -
/// onlyRole(RATE_LIMITER_MANAGER_ROLE)
///
/// The existence of the exemption PDA indicates the user is exempt from rate limiting.
///
/// Note: EVM takes an array for batch updates. On Solana, this instruction handles a single user;
/// for multiple users, bundle multiple instructions in one transaction.
#[rbac::only_role(role = RoleType::RateLimiterManager, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: SetRateLimitAddressExemptionParams)]
pub struct SetRateLimitAddressExemption<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub oft_store: Account<'info, OFTStore>,

    // EVM parity: `_setRateLimitAddressExemptions` reverts on idempotent calls.
    // After `init_if_needed`, a freshly created PDA has `initialized == false`
    // (zero-init); a pre-existing exempt PDA has `initialized == true`.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + RateLimitAddressExemption::INIT_SPACE,
        seeds = RateLimitAddressExemption::seeds(&oft_store.key(), &params.user),
        bump,
        constraint = exemption.initialized != params.is_exempt @ OFTError::ExemptionStateIdempotent,
    )]
    pub exemption: Account<'info, RateLimitAddressExemption>,

    pub system_program: Program<'info, System>,
}

impl SetRateLimitAddressExemption<'_> {
    pub fn apply(
        ctx: &mut Context<Self>,
        params: &SetRateLimitAddressExemptionParams,
    ) -> Result<()> {
        if params.is_exempt {
            ctx.accounts.exemption.initialized = true;
        } else {
            ctx.accounts.exemption.close(ctx.accounts.payer.to_account_info())?;
        }
        emit_cpi!(RateLimitAddressExemptionUpdated {
            oft_store: ctx.accounts.oft_store.key(),
            user: params.user,
            is_exempt: params.is_exempt
        });
        Ok(())
    }
}

/// Parameters for setting address-level rate limit exemption.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetRateLimitAddressExemptionParams {
    /// Address of the user (Solana public key).
    pub user: Pubkey,
    /// Whether the address should be exempt from the rate limit.
    pub is_exempt: bool,
}
