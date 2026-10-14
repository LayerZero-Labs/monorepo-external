use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[derive(
    Clone,
    Copy,
    PartialEq,
    Eq,
    Default,
    AnchorSerialize,
    AnchorDeserialize,
    InitSpace,
    rbac::RoleType,
    num_enum::TryFromPrimitive,
    num_enum::IntoPrimitive,
)]
#[borsh(use_discriminant = true)]
#[repr(u8)]
pub enum RoleType {
    #[default]
    DefaultAdmin = 0,
    Admin = 1,
}

#[account]
#[derive(Default, InitSpace)]
pub struct ProgramState {
    pub bump: u8,
}

#[rbac::rbac(state = ProgramState, role_type = RoleType, invalid_attr = Foo)]
pub mod my_program {
    use super::*;
}

fn main() {}
