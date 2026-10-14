use crate::{events::FeeBpsSet, FeeConfig, OFTError, OFTStore, RoleMember, RoleType};
use anchor_lang::prelude::*;

use super::MAX_FEE_BASIS_POINTS;

/// Sets the fee configuration (bps) for a destination EID.
/// EVM alignment: FeeConfigRBACUpgradeable.setFeeBps(uint256, uint16, bool) -
/// onlyRole(FEE_CONFIG_MANAGER_ROLE)
#[rbac::only_role(role = RoleType::FeeConfigManager, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: SetFeeBpsParams)]
pub struct SetFeeBps<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub oft_store: Account<'info, OFTStore>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + FeeConfig::INIT_SPACE,
        seeds = FeeConfig::seeds(&oft_store.key(), params.id),
        bump
    )]
    pub fee_config: Account<'info, FeeConfig>,

    pub system_program: Program<'info, System>,
}

impl SetFeeBps<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &SetFeeBpsParams) -> Result<()> {
        if let Some(fee_bps) = params.fee_bps {
            require!(fee_bps <= MAX_FEE_BASIS_POINTS, OFTError::InvalidFee);
            ctx.accounts.fee_config.fee_bps = fee_bps;
        } else {
            ctx.accounts.fee_config.close(ctx.accounts.payer.to_account_info())?;
        }
        emit_cpi!(FeeBpsSet {
            oft_store: ctx.accounts.oft_store.key(),
            id: params.id,
            fee_bps: params.fee_bps
        });
        Ok(())
    }
}

/// Parameters for setting fee basis points for a specific destination ID.
///
/// `fee_bps`: `Some(bps)` to set a per-ID fee override, `None` to remove the override and fall
/// back to the default fee.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetFeeBpsParams {
    /// Destination ID.
    pub id: u128,
    /// Per-ID fee override in basis points. `None` = remove override (use default).
    pub fee_bps: Option<u16>,
}
