use anchor_lang::prelude::*;

use crate::{
    constants::BUFFERED_TRANSACTION_SEED,
    events::BufferedTransactionInitialized,
    state::{BufferedTransaction, OneSigState},
    types::Hash,
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitBufferedTransactionParams {
    pub merkle_root: Hash,
    pub nonce: u64,
    // First chunk of the Borsh-serialized `Vec<OneSigCall>`; append the rest via
    // append_buffered_transaction.
    pub init_calls_data: Vec<u8>,
    pub proof: Vec<Hash>,
}

#[event_cpi]
#[derive(Accounts)]
#[instruction(params: InitBufferedTransactionParams)]
pub struct InitBufferedTransaction<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    pub one_sig_state: Account<'info, OneSigState>,

    #[account(
        init,
        payer = authority,
        // 8 (discriminator) + fixed fields + dynamic calls_data bytes + 32 * proof.len().
        // INIT_SPACE covers authority + the two Vec headers; elements are added here.
        space = 8 + BufferedTransaction::INIT_SPACE + params.init_calls_data.len() + params.proof.len() * 32,
        seeds = [
            BUFFERED_TRANSACTION_SEED,
            one_sig_state.key().as_ref(),
            params.merkle_root.as_ref(),
            &params.nonce.to_be_bytes(),
            authority.key().as_ref(),
        ],
        bump,
    )]
    pub buffered_transaction: Account<'info, BufferedTransaction>,

    pub system_program: Program<'info, System>,
}

impl InitBufferedTransaction<'_> {
    pub fn apply(
        ctx: Context<InitBufferedTransaction>,
        params: InitBufferedTransactionParams,
    ) -> Result<()> {
        ctx.accounts.buffered_transaction.set_inner(BufferedTransaction {
            authority: ctx.accounts.authority.key(),
            calls_data: params.init_calls_data,
            proof: params.proof,
        });

        emit_cpi!(BufferedTransactionInitialized {
            one_sig_account: ctx.accounts.one_sig_state.key(),
            merkle_root: params.merkle_root,
            authority: ctx.accounts.authority.key(),
            nonce: params.nonce,
        });

        Ok(())
    }
}
