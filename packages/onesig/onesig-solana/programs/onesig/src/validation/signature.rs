use std::collections::HashSet;

use anchor_lang::{prelude::*, solana_program::secp256k1_recover::secp256k1_recover};

use crate::{
    constants::*,
    errors::*,
    types::{Address, Hash, Secp256k1Pubkey, Signature},
};

pub struct SignatureValidator;

impl SignatureValidator {
    // Verifies multiple signatures against signer list and threshold
    pub fn verify_signatures(
        threshold: u8,
        signers: &[Address],
        digest: &Hash,
        signatures: &[u8],
    ) -> Result<()> {
        require!(threshold > 0, OneSigError::InvalidThreshold);

        require!(
            signatures.len() % SIGNATURE_BYTES_LEN == 0,
            OneSigError::SignatureDataSizeMismatch
        );

        // Verify we have at least threshold number of signatures
        require!(
            signatures.len() >= threshold as usize * SIGNATURE_BYTES_LEN,
            OneSigError::InsufficientSignatures
        );

        // Track which signers have already provided a signature
        let mut seen_signers = HashSet::new();
        for chunk_signature in signatures.chunks(SIGNATURE_BYTES_LEN) {
            // Extract signature for this signer
            let signature: &Signature = &chunk_signature.try_into()?;
            // Recover signer public key
            let recovered_signer = SignatureValidator::recover_signer(digest, signature)?;
            let recovered_address: Address = recovered_signer.into();

            // Verify the recovered signer is in the authorized signers list
            require!(signers.contains(&recovered_address), OneSigError::MissingSigner);

            // Mark this signer as seen and check if we've already processed this signer
            let is_new = seen_signers.insert(recovered_address);
            require!(is_new, OneSigError::DuplicateSigners);
        }
        Ok(())
    }

    // Recovers the signer public key from a signature
    fn recover_signer(digest: &Hash, signature: &Signature) -> Result<Secp256k1Pubkey> {
        let (recovery_id, signature_r_s) = signature.split_recovery_id();
        let recovery_id =
            if (27..=28).contains(recovery_id) { recovery_id - 27 } else { *recovery_id };

        // Recover public key
        let signer: Secp256k1Pubkey =
            secp256k1_recover(digest.as_ref(), recovery_id, signature_r_s)
                .map_err(|_| OneSigError::FailedSignatureRecovery)?
                .into();

        Ok(signer)
    }
}
