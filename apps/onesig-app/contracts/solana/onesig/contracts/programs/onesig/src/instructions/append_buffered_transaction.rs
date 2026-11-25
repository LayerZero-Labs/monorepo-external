use anchor_lang::prelude::*;

use crate::{errors::OneSigError, state::BufferedTransaction};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AppendBufferedTransactionParams {
    // Byte offset in calls_data where this chunk starts, i.e. the expected
    // calls_data.len() before this append. Guards against out-of-order or
    // duplicated appends when multiple append transactions are sent in a batch.
    pub start_offset: u32,
    pub calls_data: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(params: AppendBufferedTransactionParams)]
pub struct AppendBufferedTransaction<'info> {
    #[account(mut, address = buffered_transaction.authority @OneSigError::UnauthorizedBufferedAuthority)]
    pub authority: Signer<'info>,

    // Grow the account by this chunk's length. Reallocating per append keeps each
    // step within Solana's 10KB per-instruction growth limit, so large payloads
    // are uploaded across several appends.
    #[account(
        mut,
        realloc = buffered_transaction.to_account_info().data_len() + params.calls_data.len(),
        realloc::payer = authority,
        realloc::zero = false,
    )]
    pub buffered_transaction: Account<'info, BufferedTransaction>,

    pub system_program: Program<'info, System>,
}

impl AppendBufferedTransaction<'_> {
    pub fn apply(
        ctx: Context<AppendBufferedTransaction>,
        params: AppendBufferedTransactionParams,
    ) -> Result<()> {
        let buffered_transaction = &mut ctx.accounts.buffered_transaction;
        require!(
            buffered_transaction.calls_data.len() == params.start_offset as usize,
            OneSigError::BufferedStartOffsetMismatch
        );
        buffered_transaction.calls_data.extend_from_slice(&params.calls_data);
        Ok(())
    }
}
