use anchor_lang::prelude::*;

use crate::{errors::OneSigError, state::BufferedSignatures};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AppendBufferedSignaturesParams {
    // Byte offset in signatures where this chunk starts, i.e. the expected
    // signatures.len() before this append. Guards against out-of-order appends.
    pub start_offset: u32,
    pub signatures: Vec<u8>,
}

/// Appends raw signature bytes to an existing buffered signatures account.
#[derive(Accounts)]
#[instruction(params: AppendBufferedSignaturesParams)]
pub struct AppendBufferedSignatures<'info> {
    #[account(mut, address = buffered_signatures.authority @OneSigError::UnauthorizedBufferedAuthority)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        realloc = buffered_signatures.to_account_info().data_len() + params.signatures.len(),
        realloc::payer = authority,
        realloc::zero = false,
    )]
    pub buffered_signatures: Account<'info, BufferedSignatures>,

    pub system_program: Program<'info, System>,
}

impl AppendBufferedSignatures<'_> {
    pub fn apply(
        ctx: Context<AppendBufferedSignatures>,
        params: AppendBufferedSignaturesParams,
    ) -> Result<()> {
        let buffered_signatures = &mut ctx.accounts.buffered_signatures;
        require!(
            buffered_signatures.signatures.len() == params.start_offset as usize,
            OneSigError::BufferedStartOffsetMismatch
        );
        buffered_signatures.signatures.extend_from_slice(&params.signatures);
        Ok(())
    }
}
