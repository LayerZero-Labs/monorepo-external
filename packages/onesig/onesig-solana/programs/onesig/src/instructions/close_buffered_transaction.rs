use anchor_lang::prelude::*;

use crate::{errors::OneSigError, events::BufferedTransactionClosed, state::BufferedTransaction};

/// Closes a `BufferedTransaction` PDA and refunds rent to its `authority`.
///
/// This is the manual path, for reclaiming rent from a buffered transaction that will not be
/// executed (e.g. abandoned or superseded). A successful `execute_transaction` already closes
/// the buffered transaction itself, so this instruction is not needed on the normal path.
#[event_cpi]
#[derive(Accounts)]
pub struct CloseBufferedTransaction<'info> {
    #[account(mut, address = buffered_transaction.authority @OneSigError::UnauthorizedBufferedAuthority)]
    pub authority: Signer<'info>,

    #[account(mut, close = authority)]
    pub buffered_transaction: Account<'info, BufferedTransaction>,
}

impl CloseBufferedTransaction<'_> {
    pub fn apply(ctx: Context<CloseBufferedTransaction>) -> Result<()> {
        emit_cpi!(BufferedTransactionClosed {
            buffered_transaction: ctx.accounts.buffered_transaction.key(),
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}
