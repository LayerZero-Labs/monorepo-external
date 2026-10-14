pub mod state;

use anchor_lang::prelude::*;
use state::{VaultRoleType, VaultState, VAULT_SEED};

declare_id!("Vau1111111111111111111111111111111111111111");

// ── Account structs ───────────────────────────────────────────────────────────

/// Initialize accounts.
///
/// `#[init_default_admin]` injects `admin_role_member` — a PDA that marks
/// the payer as the initial `DefaultAdmin` — so the role is established
/// atomically with state creation.
#[rbac::init_default_admin(state = state, role_type = VaultRoleType, payer = payer, admin = payer.key())]
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [VAULT_SEED],
        bump,
    )]
    pub state: Account<'info, VaultState>,

    pub system_program: Program<'info, System>,
}

/// Deposit accounts.
///
/// `#[only_role]` injects `role_member` — an existence check that the
/// authority holds the `Depositor` role — without any extra code in the handler.
#[rbac::only_role(role = VaultRoleType::Depositor, state = state, authority = authority)]
#[derive(Accounts)]
pub struct Deposit<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [VAULT_SEED], bump = state.bump)]
    pub state: Account<'info, VaultState>,
}

// ── Program module ────────────────────────────────────────────────────────────
//
// Custom instructions:
//   initialize  — creates vault state; grants DefaultAdmin to payer
//   deposit     — Depositor-only; increments balance (shows #[only_role])
//
// RBAC-generated instructions (all use default accounts + handlers):
//   grant_role                   — DefaultAdmin grants any non-admin role
//   revoke_role                  — DefaultAdmin revokes any non-admin role
//   renounce_role                — role holder renounces own role
//   begin_default_admin_transfer — current admin initiates a two-step transfer
//   accept_default_admin_transfer — pending admin accepts; atomically swaps
//   get_default_admin            — view: returns current/pending admin pubkeys

#[rbac::rbac(state = VaultState, role_type = VaultRoleType)]
pub mod vault {
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.state.balance = 0;
        ctx.accounts.state.bump = ctx.bumps.state;
        rbac::setup_default_admin!(ctx, state, ctx.accounts.payer.key(), VaultRoleType, payer);
        Ok(())
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        ctx.accounts.state.balance = ctx.accounts.state.balance.saturating_add(amount);
        Ok(())
    }
}
