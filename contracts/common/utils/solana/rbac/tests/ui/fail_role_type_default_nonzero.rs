//! Test that RoleType derive fails when the `#[default]` variant has a
//! non-zero discriminant. Pinning it to 0 keeps PDA seeds aligned with EVM
//! `DEFAULT_ADMIN_ROLE = 0x00`.

use anchor_lang::prelude::*;
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
    num_enum::TryFromPrimitive,
    num_enum::IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum BadRoleType {
    Admin = 0,
    #[default]
    DefaultAdmin = 1,
}

fn main() {}
