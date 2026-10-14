use anchor_lang::prelude::*;
use rbac::{DefaultAdmin, RoleType};

pub const VAULT_SEED: &[u8] = b"vault";

/// Vault program state.
///
/// Embeds `current_default_admin` / `pending_default_admin` directly so that
/// `#[derive(DefaultAdmin)]` can generate the `DefaultAdmin` trait impl without
/// a separate PDA account.
#[account]
#[derive(InitSpace, DefaultAdmin)]
pub struct VaultState {
    pub balance: u64,
    pub bump: u8,
    pub current_default_admin: Pubkey,
    pub pending_default_admin: Pubkey,
}

/// Role enum for the vault program.
///
/// - `DefaultAdmin` (= 0): the root role; administers all other roles. Created by `initialize` via
///   `#[init_default_admin]`.
/// - `Depositor` (= 1): non-admin role; required to call `deposit`. Granted post-init via
///   `grant_role`.
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
pub enum VaultRoleType {
    #[default]
    DefaultAdmin = 0,
    Depositor = 1,
}
