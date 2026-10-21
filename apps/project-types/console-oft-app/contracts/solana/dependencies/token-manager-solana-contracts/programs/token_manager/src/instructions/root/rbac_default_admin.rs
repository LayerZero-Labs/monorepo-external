use crate::{
    authority::authorize_native, errors::TokenManagerError, PendingAdminSet, RoleMember, RoleType,
    TokenManagerStore,
};
use anchor_lang::prelude::*;

/// The pending admin proves it can sign by accepting; only then does a DefaultAdmin exist.
/// `setup_default_admin!` rejects a second acceptance once `current_default_admin` is set.
#[rbac::init_default_admin(state = token_manager, role_type = RoleType, payer = payer, admin = token_manager.pending_default_admin)]
#[derive(Accounts)]
pub struct AcceptTokenManagerAdmin<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(address = token_manager.pending_default_admin @ rbac::RbacError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(mut)]
    pub token_manager: Account<'info, TokenManagerStore>,

    pub system_program: Program<'info, System>,
}

impl AcceptTokenManagerAdmin<'_> {
    pub fn apply(ctx: &mut Context<Self>) -> Result<()> {
        rbac::setup_default_admin!(ctx, token_manager, ctx.accounts.admin.key(), RoleType, admin);
        Ok(())
    }
}

/// Before acceptance, the bootstrap (the native key that authorized creation) may re-point the
/// pending admin, so a typo or unsignable key is recoverable even after the bootstrap's native
/// authority has been handed to a signer PDA.
/// Remaining accounts are ONLY native multisig members for `authority`.
#[event_cpi]
#[derive(Accounts)]
pub struct SetPendingTokenManagerAdmin<'info> {
    /// CHECK: Must be the stored bootstrap; authenticated by `authorize_native`. Pass it as a
    /// signer for a plain key or CPI-signing PDA, and as a non-signer for a native multisig, whose
    /// member signers are the remaining accounts.
    #[account(address = token_manager.bootstrap @ TokenManagerError::InvalidAuthority)]
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub token_manager: Account<'info, TokenManagerStore>,
}

impl<'info> SetPendingTokenManagerAdmin<'info> {
    pub fn apply(ctx: &mut Context<'info, Self>, pending_admin: Pubkey) -> Result<()> {
        let token_manager = &ctx.accounts.token_manager;
        require_keys_eq!(
            token_manager.current_default_admin,
            Pubkey::default(),
            rbac::RbacError::DefaultAdminAlreadyInitialized
        );
        require_keys_neq!(pending_admin, Pubkey::default(), rbac::RbacError::InvalidDefaultAdmin);
        authorize_native(
            &token_manager.bootstrap,
            &ctx.accounts.authority,
            ctx.remaining_accounts,
        )?;

        ctx.accounts.token_manager.pending_default_admin = pending_admin;
        emit_cpi!(PendingAdminSet {
            token_manager: ctx.accounts.token_manager.key(),
            pending_admin,
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}
