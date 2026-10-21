use crate::{PubkeyPolicy, PubkeyPolicyInitialized, PubkeyPolicyMode, RoleMember, RoleType};
use anchor_lang::prelude::*;
use pubkey_policy_interface::PUBKEY_POLICY_SEED;

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitPubkeyPolicyParams {
    /// Not validated; it only namespaces the policy address.
    pub mint: Pubkey,
    pub admin: Pubkey,
    pub mode: PubkeyPolicyMode,
}

/// Permissionless: anyone may create their own policy for any mint; it binds nothing until a
/// consumer selects it. `initializer` signs because it is a seed, so no one else can create the
/// policy at its address.
#[rbac::init_default_admin(state = policy, role_type = RoleType, payer = payer, admin = params.admin)]
#[derive(Accounts)]
#[instruction(params: InitPubkeyPolicyParams)]
pub struct InitPubkeyPolicy<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub initializer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + PubkeyPolicy::INIT_SPACE,
        seeds = [PUBKEY_POLICY_SEED, params.mint.as_ref(), initializer.key().as_ref()],
        bump,
    )]
    pub policy: Account<'info, PubkeyPolicy>,

    pub system_program: Program<'info, System>,
}

impl InitPubkeyPolicy<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &InitPubkeyPolicyParams) -> Result<()> {
        ctx.accounts.policy.set_inner(PubkeyPolicy {
            mint: params.mint,
            current_default_admin: Pubkey::default(),
            pending_default_admin: Pubkey::default(),
            mode: params.mode,
        });
        rbac::setup_default_admin!(ctx, policy, params.admin, RoleType, payer);

        emit_cpi!(PubkeyPolicyInitialized {
            pubkey_policy: ctx.accounts.policy.key(),
            mint: params.mint,
            admin: params.admin,
            mode: params.mode,
            initializer: ctx.accounts.initializer.key(),
        });
        Ok(())
    }
}
