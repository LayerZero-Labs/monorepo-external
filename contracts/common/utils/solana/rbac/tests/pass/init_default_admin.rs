#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use rbac::{init_default_admin, RoleType};
use rbac_macros::DefaultAdmin;

declare_id!("Ctr11111111111111111111111111111111111111111");

#[account]
#[derive(InitSpace, DefaultAdmin)]
pub struct Store {
    pub bump: u8,
    pub current_default_admin: Pubkey,
    pub pending_default_admin: Pubkey,
}

#[derive(
    Clone,
    Copy,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    Default,
    RoleType,
    num_enum::TryFromPrimitive,
    num_enum::IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum TestRoleType {
    #[default]
    DefaultAdmin = 0,
    Manager = 1,
}

#[account]
#[derive(Default, InitSpace)]
pub struct RoleMember {
    pub state: Pubkey,
    pub role: TestRoleType,
    pub account: Pubkey,
    pub bump: u8,
}

#[derive(Clone, AnchorSerialize, AnchorDeserialize)]
pub struct InitParams {
    pub seed: Pubkey,
}

#[init_default_admin(state = state, role_type = TestRoleType, payer = authority, admin = authority.key())]
#[derive(Accounts)]
#[instruction(params: InitParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + Store::INIT_SPACE,
        seeds = [b"store", params.seed.as_ref()],
        bump,
    )]
    pub state: Account<'info, Store>,

    pub system_program: Program<'info, System>,
}

#[allow(dead_code)]
fn use_generated_helper(ctx: &mut Context<Initialize<'_>>) -> Result<()> {
    rbac::setup_default_admin!(
        ctx,
        state,
        ctx.accounts.authority.key(),
        TestRoleType,
        authority
    );
    Ok(())
}

fn main() {}
