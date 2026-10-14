//! Test that RoleType derive fails on enums with no `#[default]` variant.
//! `#[default]` anchors `default_admin_role()` and is required for EVM
//! `DEFAULT_ADMIN_ROLE = 0` parity.

use rbac::RoleType;

#[derive(RoleType)]
#[repr(u8)]
pub enum NoDefaultRoleType {
    Admin = 0,
    Pauser = 1,
}

fn main() {}
