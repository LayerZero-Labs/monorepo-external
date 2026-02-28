#![allow(unexpected_cfgs)]

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;
pub mod types;
pub mod validation;

use anchor_lang::prelude::*;
pub use constants::*;
pub use errors::*;
pub use events::*;
pub use instructions::*;
pub use state::*;
pub use types::*;
pub use validation::*;

declare_id!("5XDrnPsfpZ29v7DRrUtUBJ3yr5n1mhSUDyEzPuAvakHv");

#[program]
pub mod onesig {
    use super::*;

    pub fn version(_ctx: Context<GetVersion>) -> Result<String> {
        Ok(VERSION.to_string())
    }

    pub fn init_one_sig(mut ctx: Context<InitOneSig>, params: InitOneSigParams) -> Result<()> {
        InitOneSig::apply(&mut ctx, &params)
    }

    pub fn set_config(mut ctx: Context<SetConfig>, params: SetConfigParams) -> Result<()> {
        SetConfig::apply(&mut ctx, &params)
    }

    pub fn verify_merkle_root(
        mut ctx: Context<VerifyMerkleRoot>,
        params: VerifyMerkleRootParams,
    ) -> Result<()> {
        VerifyMerkleRoot::apply(&mut ctx, &params)
    }

    pub fn execute_transaction(
        mut ctx: Context<ExecuteTransaction>,
        params: ExecuteTransactionParams,
    ) -> Result<()> {
        ExecuteTransaction::apply(&mut ctx, &params)
    }

    pub fn close_merkle_root(mut ctx: Context<CloseMerkleRoot>) -> Result<()> {
        CloseMerkleRoot::apply(&mut ctx)
    }
}

#[derive(Accounts)]
pub struct GetVersion {}
