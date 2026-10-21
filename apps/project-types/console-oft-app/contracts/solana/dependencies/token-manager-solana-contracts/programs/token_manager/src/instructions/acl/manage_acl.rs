use crate::{
    authority::invoke_as, AclGatingProgramChanged, AclPermissionsChanged, RoleMember, RoleType,
    SignerKind, TokenManagerStore, SIGNER_SEED,
};
use anchor_lang::prelude::*;
use token_acl_client::instructions as acl;
use token_acl_interface::TOKEN_ACL_ID;
use token_manager_interface::acl::mint_config_address;

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct AclPermissions {
    pub freeze_enabled: bool,
    pub thaw_enabled: bool,
}

#[rbac::only_role(role = RoleType::DefaultAdmin, state = token_manager, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct ManageAcl<'info> {
    pub authority: Signer<'info>,

    pub token_manager: Account<'info, TokenManagerStore>,

    /// CHECK: This root's Acl signer PDA, expected to be the MintConfig logical admin; Token ACL
    /// enforces that.
    #[account(seeds = [SIGNER_SEED, token_manager.key().as_ref(), &[SignerKind::Acl as u8]], bump)]
    pub acl_signer: UncheckedAccount<'info>,

    /// CHECK: This mint's MintConfig, pinned by address because Token ACL's toggle and
    /// SetGatingProgram do not check the mint.
    #[account(mut, address = mint_config_address(&token_manager.mint))]
    pub mint_config: UncheckedAccount<'info>,

    /// CHECK: Pinned Token ACL, never caller-selected.
    #[account(address = TOKEN_ACL_ID, executable)]
    pub acl_program: UncheckedAccount<'info>,
}

impl ManageAcl<'_> {
    /// Sets both flags as one configuration, so it stores and emits on every call, including an
    /// unchanged one, as EVM's two-flag `setRateLimitGlobalConfig` does.
    pub fn permissions(ctx: &mut Context<Self>, params: AclPermissions) -> Result<()> {
        let a = &ctx.accounts;
        let ix = acl::TogglePermissionlessInstructionsBuilder::new()
            .authority(a.acl_signer.key())
            .mint_config(a.mint_config.key())
            .freeze_enabled(params.freeze_enabled)
            .thaw_enabled(params.thaw_enabled)
            .instruction();
        invoke_as(
            &a.token_manager.key(),
            &[(SignerKind::Acl, ctx.bumps.acl_signer)],
            &ix,
            &[
                a.acl_signer.to_account_info(),
                a.mint_config.to_account_info(),
                a.acl_program.to_account_info(),
            ],
        )?;

        emit_cpi!(AclPermissionsChanged {
            token_manager: a.token_manager.key(),
            authority: a.authority.key(),
            freeze_enabled: params.freeze_enabled,
            thaw_enabled: params.thaw_enabled
        });
        Ok(())
    }

    /// Point the mint's Token ACL config at `gating_program`, e.g. a successor TokenManager's
    /// gate. The new gate needs its own manifests (`init_acl` under that program) before
    /// permissionless thaw and freeze work again.
    ///
    /// `Pubkey::default()` leaves the config without a gate. Token ACL still calls the gate, so
    /// permissionless thaw and freeze can then never succeed: accounts change state only through
    /// `Thawer`/`Freezer`, and an OFT cannot thaw new recipients inline (it redirects them, or
    /// fails with `CreditBlocked` without a redirect escrow). To turn permissionless thaw or freeze
    /// off, prefer `set_acl_permissions`.
    pub fn gating_program(ctx: &mut Context<Self>, gating_program: Pubkey) -> Result<()> {
        let a = &ctx.accounts;
        let ix = acl::SetGatingProgramBuilder::new()
            .authority(a.acl_signer.key())
            .mint_config(a.mint_config.key())
            .new_gating_program(gating_program)
            .instruction();
        invoke_as(
            &a.token_manager.key(),
            &[(SignerKind::Acl, ctx.bumps.acl_signer)],
            &ix,
            &[
                a.acl_signer.to_account_info(),
                a.mint_config.to_account_info(),
                a.acl_program.to_account_info(),
            ],
        )?;

        emit_cpi!(AclGatingProgramChanged {
            token_manager: a.token_manager.key(),
            authority: a.authority.key(),
            gating_program
        });
        Ok(())
    }
}
