use crate::{events::DefaultPauseSet, OFTError, OFTStore, RoleMember, RoleType};
use anchor_lang::prelude::*;

/// Sets the default paused status for all destinations.
/// EVM alignment: PauseByIDRBACUpgradeable.setDefaultPaused(bool)
///   - onlyRole(PAUSER_ROLE) if pausing
///   - onlyRole(UNPAUSER_ROLE) if unpausing
#[rbac::only_role(role = required_role_for_set_default_paused(paused), state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(paused: bool)]
pub struct SetDefaultPaused<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        constraint = oft_store.default_paused != paused @ OFTError::PauseStateIdempotent)
    ]
    pub oft_store: Account<'info, OFTStore>,
}

impl SetDefaultPaused<'_> {
    pub fn apply(ctx: &mut Context<SetDefaultPaused>, paused: &bool) -> Result<()> {
        let paused = *paused;
        ctx.accounts.oft_store.default_paused = paused;
        emit_cpi!(DefaultPauseSet { oft_store: ctx.accounts.oft_store.key(), paused });
        Ok(())
    }
}

fn required_role_for_set_default_paused(paused: bool) -> RoleType {
    if paused {
        RoleType::Pauser
    } else {
        RoleType::Unpauser
    }
}
