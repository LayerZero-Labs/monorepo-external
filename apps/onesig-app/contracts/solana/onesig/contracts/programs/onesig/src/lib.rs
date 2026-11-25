#![allow(unexpected_cfgs)]
// Anchor #[program] expansion trips this under -D warnings.
#![allow(clippy::diverging_sub_expression)]

#[cfg(all(feature = "custom-heap", not(feature = "no-entrypoint"), target_os = "solana"))]
heap_allocator::declare_allocator!();

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
use program_id::declare_program_id;
pub use state::*;
pub use types::*;
pub use validation::*;

declare_program_id!("ONESIG_STAGED_ID", "6VhT6ASR4Ytg2AZbrKAcn1YFzRwaUJ2ANiTB9hueVPpr");

#[program]
pub mod onesig {
    use super::*;

    pub fn version(_ctx: Context<GetVersion>) -> Result<String> {
        Ok(VERSION.to_string())
    }

    pub fn init_one_sig(ctx: Context<InitOneSig>, params: InitOneSigParams) -> Result<()> {
        InitOneSig::apply(ctx, params)
    }

    pub fn set_config(ctx: Context<SetConfig>, params: SetConfigParams) -> Result<()> {
        SetConfig::apply(ctx, params)
    }

    pub fn init_buffered_signatures(
        ctx: Context<InitBufferedSignatures>,
        params: InitBufferedSignaturesParams,
    ) -> Result<()> {
        InitBufferedSignatures::apply(ctx, params)
    }

    pub fn append_buffered_signatures(
        ctx: Context<AppendBufferedSignatures>,
        params: AppendBufferedSignaturesParams,
    ) -> Result<()> {
        AppendBufferedSignatures::apply(ctx, params)
    }

    pub fn execute_transaction<'info>(
        ctx: Context<'info, ExecuteTransaction<'info>>,
        params: ExecuteTransactionParams,
    ) -> Result<()> {
        ExecuteTransaction::apply(ctx, params)
    }

    pub fn init_buffered_transaction(
        ctx: Context<InitBufferedTransaction>,
        params: InitBufferedTransactionParams,
    ) -> Result<()> {
        InitBufferedTransaction::apply(ctx, params)
    }

    pub fn append_buffered_transaction(
        ctx: Context<AppendBufferedTransaction>,
        params: AppendBufferedTransactionParams,
    ) -> Result<()> {
        AppendBufferedTransaction::apply(ctx, params)
    }

    pub fn close_buffered_transaction(ctx: Context<CloseBufferedTransaction>) -> Result<()> {
        CloseBufferedTransaction::apply(ctx)
    }

    pub fn close_buffered_signatures(ctx: Context<CloseBufferedSignatures>) -> Result<()> {
        CloseBufferedSignatures::apply(ctx)
    }
}

#[derive(Accounts)]
pub struct GetVersion {}
