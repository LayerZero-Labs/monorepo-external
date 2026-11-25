use anchor_lang::prelude::*;

use crate::{
    instructions::SetConfigParams,
    types::{Address, Hash},
};

#[event]
pub struct OneSigInitialized {
    pub one_sig_account: Pubkey,
    pub one_sig_id: u64,
    pub seed: Hash,
    pub threshold: u8,
    pub signers: Vec<Address>,
    pub executors: Vec<Pubkey>,
    pub executor_required: bool,
}

#[event]
pub struct ConfigSet {
    pub one_sig_account: Pubkey,
    pub params: SetConfigParams,
}

#[event]
pub struct TransactionExecuted {
    pub one_sig_account: Pubkey,
    pub merkle_root: Hash,
    pub nonce: u64,
}

#[event]
pub struct BufferedSignaturesInitialized {
    pub one_sig_account: Pubkey,
    pub merkle_root: Hash,
    pub authority: Pubkey,
    pub init_signatures_len: u32,
    pub closable_after_nonce: u64,
}

#[event]
pub struct BufferedTransactionInitialized {
    pub one_sig_account: Pubkey,
    pub merkle_root: Hash,
    pub authority: Pubkey,
    pub nonce: u64,
}

#[event]
pub struct BufferedSignaturesClosed {
    pub buffered_signatures: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct BufferedTransactionClosed {
    pub buffered_transaction: Pubkey,
    pub authority: Pubkey,
}
