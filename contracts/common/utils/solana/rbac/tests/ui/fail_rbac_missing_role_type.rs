use anchor_lang::prelude::*;

declare_id!("11111111111111111111111111111111");

#[account]
#[derive(Default, InitSpace)]
pub struct ProgramState {
    pub bump: u8,
}

#[rbac::rbac(state = ProgramState)]
pub mod my_program {
    use super::*;
}

fn main() {}
