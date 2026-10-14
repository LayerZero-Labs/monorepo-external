//! Roles administered by the token manager's two-step DefaultAdmin.

use anchor_lang::prelude::*;
use num_enum::{IntoPrimitive, TryFromPrimitive};
use rbac::RoleType;

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
    TryFromPrimitive,
    IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum RoleType {
    #[default]
    DefaultAdmin = 0,
    /// Freezes individual token accounts through Token ACL, whatever their balance.
    Freezer = 1,
    /// Thaws individual token accounts, including funded or blocked-owner accounts.
    Thawer = 2,
    /// Approves permissioned burns; source ownership/delegation is checked by Token-2022.
    Burner = 3,
    /// Burns from any account through the permanent delegate (EVM `burn(from)`).
    PdBurner = 4,
    /// Pauses the mint through the root's Pause signer (EVM `pause`).
    Pauser = 5,
    /// Resumes the mint through the root's Pause signer (EVM `unpause`).
    Unpauser = 6,
    /// Mints through the root's Mint signer (EVM `mint`).
    Minter = 7,
}
