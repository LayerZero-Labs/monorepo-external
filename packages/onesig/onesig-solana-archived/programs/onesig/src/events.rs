use anchor_lang::prelude::*;

use crate::types::{Address, Hash, SetConfigParams};

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
