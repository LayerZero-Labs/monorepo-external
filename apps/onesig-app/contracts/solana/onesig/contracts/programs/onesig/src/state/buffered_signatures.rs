use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct BufferedSignatures {
    pub authority: Pubkey,
    // Concatenated signatures buffered across init_buffered_signatures and
    // append_buffered_signatures.
    #[max_len(0)]
    pub signatures: Vec<u8>,
    // The nonce of the last leaf in this tree. The PDA is auto-closed in execute_transaction
    // once one_sig_state.nonce > closable_after_nonce. Set to u64::MAX to disable auto-close.
    pub closable_after_nonce: u64,
}
