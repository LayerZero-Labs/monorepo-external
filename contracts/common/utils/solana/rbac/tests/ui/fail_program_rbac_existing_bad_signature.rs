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

#[rbac::rbac(state = ProgramState, role_type = RoleType)]
pub mod my_program {
    use super::*;

    // Wrong signature on purpose: missing params type + wrong context type.
    pub fn grant_role(_ctx: Context<ProgramState>) -> Result<()> {
        Ok(())
    }
}

fn main() {}
