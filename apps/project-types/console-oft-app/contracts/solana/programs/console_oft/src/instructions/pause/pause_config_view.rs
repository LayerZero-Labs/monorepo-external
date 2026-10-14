use crate::{OFTStore, PauseConfig};
use anchor_lang::prelude::*;
use oapp::utils::try_load_account;

/// Shared accounts struct for pause view instructions: `is_paused`, `pause_config`.
#[derive(Accounts)]
#[instruction(id: u128)]
pub struct PauseConfigView<'info> {
    pub oft_store: Account<'info, OFTStore>,

    /// CHECK: Per-EID pause config PDA. Seeds validated by Anchor; deserialized via
    /// try_load_account. Returns None when the PDA is uninitialized.
    #[account(
        seeds = PauseConfig::seeds(&oft_store.key(), id),
        bump
    )]
    pub pause_config: UncheckedAccount<'info>,
}

impl PauseConfigView<'_> {
    pub fn is_paused(ctx: &Context<Self>, _id: &u128) -> Result<bool> {
        Ok(is_paused(
            ctx.accounts.oft_store.default_paused,
            try_load_account(&ctx.accounts.pause_config)?.as_ref(),
        ))
    }

    pub fn pause_config(ctx: &Context<Self>, _id: &u128) -> Result<Option<bool>> {
        let cfg: Option<PauseConfig> = try_load_account(&ctx.accounts.pause_config)?;
        Ok(cfg.map(|c| c.paused))
    }
}

/// Whether sends are paused, given the destination's per-ID override if any.
pub fn is_paused(default_paused: bool, cfg: Option<&PauseConfig>) -> bool {
    cfg.map_or(default_paused, |c| c.paused)
}
