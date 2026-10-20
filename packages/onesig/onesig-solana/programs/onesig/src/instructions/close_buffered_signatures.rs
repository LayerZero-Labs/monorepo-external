use anchor_lang::prelude::*;

use crate::{errors::OneSigError, events::BufferedSignaturesClosed, state::BufferedSignatures};

/// Closes a buffered signatures PDA and refunds rent to its authority.
#[event_cpi]
#[derive(Accounts)]
pub struct CloseBufferedSignatures<'info> {
    #[account(mut, address = buffered_signatures.authority @OneSigError::UnauthorizedBufferedAuthority)]
    pub authority: Signer<'info>,

    #[account(mut, close = authority)]
    pub buffered_signatures: Account<'info, BufferedSignatures>,
}

impl CloseBufferedSignatures<'_> {
    pub fn apply(ctx: Context<CloseBufferedSignatures>) -> Result<()> {
        emit_cpi!(BufferedSignaturesClosed {
            buffered_signatures: ctx.accounts.buffered_signatures.key(),
            authority: ctx.accounts.authority.key(),
        });
        Ok(())
    }
}
