use anchor_lang::prelude::*;

use crate::{
    constants::SIGNERS_MAX_LEN,
    errors::OneSigError,
    types::{Address, Hash},
    EXECUTORS_MAX_LEN, MAX_THRESHOLD,
};

/// OneSig state account holding configuration and multisig details
#[account]
#[derive(InitSpace)]
pub struct OneSigState {
    pub one_sig_id: u64,
    pub seed: Hash,
    // The bump for the one_sig_signer PDA
    pub bump: u8,
    // Transaction replay protection counter
    pub nonce: u64,
    pub multisig: Multisig,
    pub executors: Executors,
}

#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct Multisig {
    #[max_len(SIGNERS_MAX_LEN)]
    pub signers: Vec<Address>,
    pub threshold: u8,
}

impl Multisig {
    pub fn add_signer(&mut self, signer: Address) -> Result<()> {
        require!(signer != Address::default(), OneSigError::InvalidSigner);
        require!(self.signers.len() < SIGNERS_MAX_LEN, OneSigError::InvalidSignersLen);
        require!(!self.signers.contains(&signer), OneSigError::DuplicateSigners);
        self.signers.push(signer);
        Ok(())
    }

    pub fn remove_signer(&mut self, signer: Address) -> Result<()> {
        // Find the index of the signer to remove
        let index = self
            .signers
            .iter()
            .position(|signer_to_remove| *signer_to_remove == signer)
            .ok_or(OneSigError::MissingSigner)?;
        self.signers.remove(index);
        let total_signers = self.signers.len();
        require!(total_signers >= self.threshold as usize, OneSigError::ThresholdExceedsSigners);
        Ok(())
    }

    pub fn set_threshold(&mut self, threshold: u8) -> Result<()> {
        require!(threshold > 0 && threshold <= MAX_THRESHOLD, OneSigError::InvalidThreshold);
        require!(threshold as usize <= self.signers.len(), OneSigError::ThresholdExceedsSigners);
        self.threshold = threshold;
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct MerkleRootState {
    // Store root here so that we can execute tx without providing the root
    // and save instruction data size
    pub merkle_root: Hash,
    // The copied seed from the OneSigState account.
    // If this seed is not the same as the OneSigState account,
    // the merkle root is invalid
    pub seed: Hash,
    // The same type as UnixTimestamp
    pub expiry: i64,
    // Rent payer, used to close the account
    pub rent_payer: Pubkey,
    pub bump: u8,
}

#[derive(InitSpace, Clone, AnchorSerialize, AnchorDeserialize)]
pub struct Executors {
    #[max_len(EXECUTORS_MAX_LEN)]
    pub executors: Vec<Pubkey>,
    pub executor_required: bool,
}

impl Executors {
    pub fn add_executor(&mut self, executor: Pubkey) -> Result<()> {
        require!(executor != Pubkey::default(), OneSigError::InvalidExecutor);
        require!(self.executors.len() < EXECUTORS_MAX_LEN, OneSigError::InvalidExecutorsLen);
        require!(!self.executors.contains(&executor), OneSigError::DuplicateExecutor);
        self.executors.push(executor);
        Ok(())
    }

    pub fn remove_executor(&mut self, executor: Pubkey) -> Result<()> {
        // Find the index of the executor to remove
        let index = self
            .executors
            .iter()
            .position(|executor_to_remove| *executor_to_remove == executor)
            .ok_or(OneSigError::ExecutorNotFound)?;
        self.executors.remove(index);

        // Ensure that if executor_required is true, at least one executor remains
        require!(
            !self.executor_required || !self.executors.is_empty(),
            OneSigError::EmptyExecutorSet
        );
        Ok(())
    }

    pub fn set_executor_required(&mut self, required: bool) -> Result<()> {
        // If executor required is false, the executor set can be empty
        // If executor required is true, the executor set must be non-empty
        require!(!required || !self.executors.is_empty(), OneSigError::EmptyExecutorSet);
        self.executor_required = required;
        Ok(())
    }
}
