use crate::{events::PauseSet, OFTStore, PauseConfig, RoleMember, RoleType};
use anchor_lang::prelude::*;

/// Sets the pause configuration for a destination EID.
/// EVM alignment: PauseByIDRBACUpgradeable.setPaused(SetPausedParam[])
///   - onlyRole(PAUSER_ROLE) if pausing
///   - onlyRole(UNPAUSER_ROLE) if unpausing
///
/// Note: EVM takes an array of SetPausedParam for batch updates. On Solana, this instruction
/// handles a single EID; for multiple EIDs, bundle multiple `set_paused` instructions in one
/// transaction. Semantics match EVM (Some(paused) sets override, None removes override and falls
/// back to default).
/// The EVM implementation can be reproduced by bundling multiple `set_paused` ixs into a single tx.
#[rbac::only_role(role = required_role_for_set_paused(&params, oft_store.default_paused), state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: SetPausedParams)]
pub struct SetPaused<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub oft_store: Account<'info, OFTStore>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + PauseConfig::INIT_SPACE,
        seeds = PauseConfig::seeds(&oft_store.key(), params.id),
        bump
    )]
    pub pause_config: Account<'info, PauseConfig>,

    pub system_program: Program<'info, System>,
}

impl SetPaused<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &SetPausedParams) -> Result<()> {
        if let Some(paused) = params.paused {
            ctx.accounts.pause_config.paused = paused;
        } else {
            ctx.accounts.pause_config.close(ctx.accounts.payer.to_account_info())?;
        }
        emit_cpi!(PauseSet {
            oft_store: ctx.accounts.oft_store.key(),
            id: params.id,
            paused: params.paused
        });
        Ok(())
    }
}

fn required_role_for_set_paused(params: &SetPausedParams, default_paused: bool) -> RoleType {
    // Match EVM's effective paused check:
    // (_params[i].paused.isSome() ? _params[i].paused.unwrap() : _defaultPaused)
    let effective_paused = params.paused.unwrap_or(default_paused);

    if effective_paused {
        RoleType::Pauser
    } else {
        RoleType::Unpauser
    }
}

/// Parameter for setting pause state for a destination ID.
///
/// `paused`: `Some(true)` / `Some(false)` to set a per-ID override, `None` to remove the
/// override and fall back to the default pause state.
#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetPausedParams {
    /// Destination ID.
    pub id: u128,
    /// Per-ID pause override. `None` = remove override (use default).
    pub paused: Option<bool>,
}
