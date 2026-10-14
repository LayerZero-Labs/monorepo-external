//! Test that RoleType derive fails on structs

use rbac::RoleType;

// Not an enum - should fail
#[derive(RoleType)]
#[repr(u8)]
pub struct BadRoleType {
    value: u8,
}

fn main() {}
