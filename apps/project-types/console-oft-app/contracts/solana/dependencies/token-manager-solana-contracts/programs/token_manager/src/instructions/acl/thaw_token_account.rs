use super::helpers::set_frozen;
use crate::{
    RoleMember, RoleType, SignerKind, TokenAccountStateChanged, TokenManagerStore, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use token_acl_interface::TOKEN_ACL_ID;

/// Discretionary issuer operation: bypasses the permissionless gate, so balance and membership do
/// not matter.
#[rbac::only_role(role = RoleType::Thawer, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct ThawTokenAccount<'info> {
    pub authority: Signer<'info>,

    #[account(has_one = mint)]
    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This root's Acl signer PDA, expected to be the MintConfig logical admin; Token ACL
    /// enforces that.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::Acl as u8]], bump)]
    pub acl_signer: UncheckedAccount<'info>,

    /// CHECK: Token ACL checks it against the MintConfig; Token-2022 against the account.
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Token-2022 checks its owner and mint when freezing or thawing it.
    #[account(mut)]
    pub token_account: UncheckedAccount<'info>,

    /// CHECK: This mint's MintConfig; Token ACL checks its owner and stored mint.
    pub mint_config: UncheckedAccount<'info>,

    /// CHECK: Pinned Token ACL, never caller-selected.
    #[account(address = TOKEN_ACL_ID, executable)]
    pub acl_program: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token2022>,
}

impl ThawTokenAccount<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        let a = &ctx.accounts;
        set_frozen(
            false,
            &a.token_manager.key(),
            &a.acl_signer,
            ctx.bumps.acl_signer,
            &a.mint.to_account_info(),
            &a.token_account.to_account_info(),
            &a.mint_config,
            &a.token_program.to_account_info(),
            &a.acl_program,
        )?;

        emit_cpi!(TokenAccountStateChanged {
            token_manager: a.token_manager.key(),
            token_account: a.token_account.key(),
            frozen: false,
            authority: a.authority.key(),
        });
        Ok(())
    }
}
