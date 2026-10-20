use anchor_lang::prelude::*;

use crate::{
    constants::BUFFERED_SIGNATURES_SEED,
    errors::OneSigError,
    events::BufferedSignaturesInitialized,
    state::{BufferedSignatures, OneSigState},
    types::Hash,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitBufferedSignaturesParams {
    pub merkle_root: Hash,
    // First chunk of concatenated signatures; append the rest via append_buffered_signatures.
    pub init_signatures: Vec<u8>,
    // Caller-chosen close threshold: the PDA auto-closes in execute_transaction once
    // one_sig_state.nonce exceeds it, so it is expected to be the tree's last-leaf nonce.
    // u64::MAX disables auto-close.
    pub closable_after_nonce: u64,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: InitBufferedSignaturesParams)]
pub struct InitBufferedSignatures<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        // INIT_SPACE includes fixed fields and the signatures Vec header; add the first chunk.
        space = 8 + BufferedSignatures::INIT_SPACE + params.init_signatures.len(),
        seeds = [
            BUFFERED_SIGNATURES_SEED,
            one_sig_state.key().as_ref(),
            params.merkle_root.as_ref(),
            authority.key().as_ref(),
        ],
        bump,
    )]
    pub buffered_signatures: Account<'info, BufferedSignatures>,

    pub one_sig_state: Account<'info, OneSigState>,

    pub system_program: Program<'info, System>,
}

impl InitBufferedSignatures<'_> {
    pub fn apply(
        ctx: Context<InitBufferedSignatures>,
        params: InitBufferedSignaturesParams,
    ) -> Result<()> {
        let InitBufferedSignaturesParams { merkle_root, init_signatures, closable_after_nonce } =
            params;

        // Setting `closable_after_nonce` below the tree's last-leaf nonce causes the PDA to
        // auto-close before all leaves have been applied; any subsequent apply call that still
        // needs the buffered signatures will fail. The root can be re-inited to recover,
        // but it is a convenience/rent optimization, not a security boundary — the SDK is
        // expected to set it to the tree's last-leaf nonce.
        require!(
            closable_after_nonce >= ctx.accounts.one_sig_state.nonce,
            OneSigError::InvalidClosableNonce
        );

        let init_signatures_len = init_signatures.len() as u32;
        ctx.accounts.buffered_signatures.set_inner(BufferedSignatures {
            authority: ctx.accounts.authority.key(),
            signatures: init_signatures,
            closable_after_nonce,
        });

        emit_cpi!(BufferedSignaturesInitialized {
            one_sig_account: ctx.accounts.one_sig_state.key(),
            merkle_root,
            authority: ctx.accounts.authority.key(),
            init_signatures_len,
            closable_after_nonce,
        });

        Ok(())
    }
}
