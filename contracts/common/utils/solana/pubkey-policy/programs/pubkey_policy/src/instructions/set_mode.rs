use crate::{
    errors::PubkeyPolicyError, ModeChanged, PubkeyPolicy, PubkeyPolicyMode, RoleMember, RoleType,
};
use anchor_lang::prelude::*;

#[rbac::only_role(role = RoleType::DefaultAdmin, state = policy, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
pub struct SetMode<'info> {
    pub authority: Signer<'info>,

    #[account(mut)]
    pub policy: Account<'info, PubkeyPolicy>,
}

impl SetMode<'_> {
    pub fn apply(ctx: &mut Context<Self>, mode: PubkeyPolicyMode) -> Result<()> {
        require!(ctx.accounts.policy.mode != mode, PubkeyPolicyError::ModeAlreadySet);
        ctx.accounts.policy.mode = mode;

        emit_cpi!(ModeChanged {
            pubkey_policy: ctx.accounts.policy.key(),
            mode,
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}
