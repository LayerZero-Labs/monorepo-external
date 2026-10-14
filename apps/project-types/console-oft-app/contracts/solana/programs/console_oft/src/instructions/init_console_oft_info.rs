use crate::console_oft_info::{init_console_oft_info, ConsoleOftInfo};
use anchor_lang::prelude::*;
use oapp::{
    oapp_info::{OAppBase, TlvSpace},
    OAPP_INFO_SEED,
};
use oft::oft_info::OftInfo;

#[derive(Accounts)]
pub struct InitConsoleOftInfo<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Raw SPL TLV account — no Anchor discriminator. Address verified
    /// by PDA seeds; ownership and allocation enforced by `init`.
    #[account(
        init,
        payer = payer,
        space = OAppBase::TLV_SPACE + OftInfo::TLV_SPACE + ConsoleOftInfo::TLV_SPACE,
        seeds = [OAPP_INFO_SEED],
        bump,
    )]
    pub oapp_info: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

impl InitConsoleOftInfo<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let oapp_info = ctx.accounts.oapp_info.to_account_info();
        init_console_oft_info(&oapp_info)
    }
}
