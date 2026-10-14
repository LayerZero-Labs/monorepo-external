use super::membership::update_membership;
use crate::{MembershipChanged, PubkeyPolicy, RoleMember, RoleType};
use anchor_lang::prelude::*;
use pubkey_policy_interface::{SubjectRecord, SUBJECT_SEED};

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct SetWhitelistedParams {
    pub subject: Pubkey,
    pub whitelisted: bool,
}

#[rbac::only_role(role = RoleType::Whitelister, state = policy, authority = authority)]
#[event_cpi]
#[derive(Accounts)]
#[instruction(params: SetWhitelistedParams)]
pub struct SetWhitelisted<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub authority: Signer<'info>,

    pub policy: Account<'info, PubkeyPolicy>,

    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + SubjectRecord::INIT_SPACE,
        seeds = [SUBJECT_SEED, policy.key().as_ref(), params.subject.as_ref()],
        bump,
    )]
    pub record: Account<'info, SubjectRecord>,

    pub system_program: Program<'info, System>,
}

impl SetWhitelisted<'_> {
    pub fn apply(ctx: &mut Context<Self>, params: &SetWhitelistedParams) -> Result<()> {
        let membership = update_membership(
            &mut ctx.accounts.record,
            &ctx.accounts.policy.key(),
            &params.subject,
            |membership| {
                membership.whitelisted = params.whitelisted;
            },
        )?;

        emit_cpi!(MembershipChanged {
            pubkey_policy: ctx.accounts.policy.key(),
            mint: ctx.accounts.policy.mint,
            subject: params.subject,
            membership,
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}
