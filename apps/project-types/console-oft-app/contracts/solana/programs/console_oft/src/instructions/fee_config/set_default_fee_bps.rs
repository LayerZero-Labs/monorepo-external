use super::MAX_FEE_BASIS_POINTS;
use crate::{events::DefaultFeeBpsSet, OFTError, OFTStore, RoleMember, RoleType};
use anchor_lang::prelude::*;

/// Sets the default fee basis points (BPS) for all destinations.
#[rbac::only_role(role = RoleType::FeeConfigManager, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct SetDefaultFeeBps<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,
}

impl SetDefaultFeeBps<'_> {
    pub fn apply(ctx: &mut Context<Self>, fee_bps: &u16) -> Result<()> {
        let fee_bps = *fee_bps;
        require!(fee_bps <= MAX_FEE_BASIS_POINTS, OFTError::InvalidFee);
        ctx.accounts.oft_store.default_fee_bps = fee_bps;
        emit_cpi!(DefaultFeeBpsSet { oft_store: ctx.accounts.oft_store.key(), fee_bps });
        Ok(())
    }
}
