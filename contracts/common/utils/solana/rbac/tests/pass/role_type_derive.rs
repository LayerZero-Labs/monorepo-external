//! Test that RoleType derive macro compiles and works correctly.
//!
//! This demonstrates the derive macro that auto-generates RoleType impl.

use anchor_lang::prelude::*;
use rbac::traits::RoleType;
use rbac::RoleType as DeriveRoleType;

// Valid 32-byte pubkey (system program)
declare_id!("11111111111111111111111111111111");

// Basic derive - DefaultAdmin is auto-detected as the default admin role
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    Default,
    DeriveRoleType,
    num_enum::TryFromPrimitive,
    num_enum::IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum BasicRoleType {
    #[default]
    DefaultAdmin = 0,
    Admin = 1,
    Pauser = 2,
}

// Manual RoleType impl with custom admin hierarchy.
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    Default,
    num_enum::TryFromPrimitive,
    num_enum::IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum HierarchicalRoleType {
    #[default]
    DefaultAdmin = 0,
    RoleManager = 1,
    Pauser = 2,
    Unpauser = 3,
}

impl RoleType for HierarchicalRoleType {
    fn default_admin_role() -> Self {
        Self::DefaultAdmin
    }

    fn role_admin(&self) -> Self {
        match self {
            Self::Pauser | Self::Unpauser => Self::RoleManager,
            _ => Self::DefaultAdmin,
        }
    }
}

// Derive without a variant named DefaultAdmin - uses first variant as default
#[derive(
    Clone,
    Copy,
    Debug,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    Default,
    DeriveRoleType,
    num_enum::TryFromPrimitive,
    num_enum::IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum NoDefaultAdminRoleType {
    #[default]
    SuperAdmin = 0, // Will be used as the default admin
    Operator = 1,
}

fn main() {
    // Test BasicRoleType
    assert_eq!(u8::from(BasicRoleType::DefaultAdmin), 0);
    assert_eq!(u8::from(BasicRoleType::Admin), 1);
    assert_eq!(u8::from(BasicRoleType::Pauser), 2);
    assert_eq!(BasicRoleType::DefaultAdmin.role_admin(), BasicRoleType::DefaultAdmin);
    assert_eq!(BasicRoleType::Admin.role_admin(), BasicRoleType::DefaultAdmin);
    assert_eq!(BasicRoleType::Pauser.role_admin(), BasicRoleType::DefaultAdmin);

    // Test HierarchicalRoleType with custom admin
    assert_eq!(HierarchicalRoleType::DefaultAdmin.role_admin(), HierarchicalRoleType::DefaultAdmin);
    assert_eq!(HierarchicalRoleType::RoleManager.role_admin(), HierarchicalRoleType::DefaultAdmin);
    assert_eq!(HierarchicalRoleType::Pauser.role_admin(), HierarchicalRoleType::RoleManager); // Custom!
    assert_eq!(HierarchicalRoleType::Unpauser.role_admin(), HierarchicalRoleType::RoleManager); // Custom!

    // Test NoDefaultAdminRoleType - first variant is default admin
    assert_eq!(NoDefaultAdminRoleType::SuperAdmin.role_admin(), NoDefaultAdminRoleType::SuperAdmin);
    assert_eq!(NoDefaultAdminRoleType::Operator.role_admin(), NoDefaultAdminRoleType::SuperAdmin);
}
