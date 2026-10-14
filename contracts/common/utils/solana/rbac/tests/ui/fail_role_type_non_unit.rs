//! Test that RoleType derive fails on enums with non-unit variants

use rbac::RoleType;

// Has tuple variant - should fail
#[derive(RoleType)]
#[repr(u8)]
pub enum BadRoleType {
    Admin = 0,
    Custom(u8) = 1, // Not a unit variant
}

fn main() {}
