use crate::{
    events::CreditRedirectConfigSet, state::CreditRedirectConfig, OFTError, OFTStore, RoleMember,
    RoleType,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

/// Sets or overwrites the credit redirect escrow, or disables redirect when none is supplied.
///
/// The redirect destination is configuration; eligibility is evaluated locally on receive.
/// Authority: DefaultAdmin.
#[rbac::only_role(role = RoleType::DefaultAdmin, state = oft_store, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct SetCreditRedirectConfig<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub oft_store: Account<'info, OFTStore>,

    #[account(address = oft_store.token_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,

    /// Not owned by `oft_store`: the OFT spends only from its own escrow, so a credit to any other
    /// account it owns could never leave, and its escrow's balance backs locked supply.
    #[account(
        token::mint = token_mint,
        constraint = !redirect_escrow.is_frozen()
            @ OFTError::RedirectEscrowFrozen,
        constraint = redirect_escrow.owner != oft_store.key()
            @ OFTError::InvalidRedirectEscrow,
    )]
    pub redirect_escrow: Option<InterfaceAccount<'info, TokenAccount>>,
}

impl SetCreditRedirectConfig<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let config = ctx
            .accounts
            .redirect_escrow
            .as_ref()
            .map(|escrow| CreditRedirectConfig { redirect_escrow: escrow.key() });
        ctx.accounts.oft_store.credit_redirect_config = config;

        emit_cpi!(CreditRedirectConfigSet { oft_store: ctx.accounts.oft_store.key(), config });
        Ok(())
    }
}
