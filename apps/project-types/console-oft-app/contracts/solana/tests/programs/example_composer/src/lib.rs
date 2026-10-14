//! # Example Composer Program
//!
//! A minimal example demonstrating how to implement a LayerZero composer
//! using the `#[composer]` macro from `oapp-macros`.
//!
//! **This is for integration-testing purposes only.**

pub mod instructions;

use anchor_lang::prelude::*;
use instructions::*;
use oapp::{composer, lz_compose_types_v3::LzComposeTypesV3Accounts, types::LzComposeParams};

declare_id!("Comp111111111111111111111111111111111111111");

pub const COMPOSER_SEED: &[u8] = b"Composer";

/// Global state for the example composer program.
///
/// Stores a counter for testing/verification purposes.
#[account]
#[derive(InitSpace)]
pub struct ComposerStore {
    /// The OFT store whose receives queue compose messages here: the only trusted sender. Anyone
    /// can queue a compose message, so `lz_compose` checks `params.from` against it.
    pub oft_store: Pubkey,
    /// Counter incremented each time lz_compose is called (for testing)
    pub compose_count: u64,
    pub bump: u8,
}

impl ComposerStore {
    pub fn signer_seeds(&self) -> [&[u8]; 2] {
        [COMPOSER_SEED, std::slice::from_ref(&self.bump)]
    }
}

#[composer]
pub mod example_composer {
    pub fn init(mut ctx: Context<Init>, oft_store: Pubkey) -> Result<()> {
        Init::apply(&mut ctx, oft_store)
    }

    #[composer_instruction]
    pub fn lz_compose_types_info(
        ctx: &Context<LzComposeTypesInfo>,
        params: &LzComposeParams,
    ) -> Result<(u8, LzComposeTypesV3Accounts)> {
        LzComposeTypesInfo::apply(ctx, params)
    }

    #[composer_instruction]
    pub fn lz_compose_types_v3(
        ctx: &mut Context<LzComposeTypesV3>,
        params: &LzComposeParams,
    ) -> Result<u32> {
        LzComposeTypesV3::apply(ctx, params)
    }

    #[composer_instruction]
    pub fn lz_compose(ctx: &mut Context<LzCompose>, params: &LzComposeParams) -> Result<()> {
        LzCompose::apply(ctx, params)
    }
}

#[error_code]
pub enum ComposerError {
    #[msg("Compose message was not queued by the OFT this composer serves")]
    UntrustedSender,
}
