//! Roles administered by each policy's two-step DefaultAdmin.

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
    /// Sets blacklist membership only, not whitelist membership or the mode.
    Blacklister = 1,
    /// Sets whitelist membership only, not blacklist membership or the mode.
    Whitelister = 2,
}
