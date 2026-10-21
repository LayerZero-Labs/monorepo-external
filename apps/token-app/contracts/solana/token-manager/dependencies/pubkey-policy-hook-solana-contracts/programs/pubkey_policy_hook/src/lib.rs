//! Optional transfer-time enforcement of a bound pubkey policy.

use anchor_lang::prelude::*;
use program_id::declare_program_id;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use events::*;
pub use instructions::*;
pub use state::*;

declare_program_id!("PUBKEY_POLICY_HOOK_ID", "7HTVK1Jwzjd4yRGCZnLT4QmwhmZidurFxwz2RMAiUyzk");

#[program]
pub mod pubkey_policy_hook {
    use super::*;

    /// Create or rewrite the mint's hook manifest to bind `pubkey_policy`. Requires the mint's
    /// hook-update authority; changes neither the policy nor the mint.
    pub fn init_transfer_hook(mut ctx: Context<InitTransferHook>) -> Result<()> {
        InitTransferHook::apply(&mut ctx)
    }

    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, params: TransferHookParams) -> Result<()> {
        TransferHook::apply(&ctx, &params)
    }
}
