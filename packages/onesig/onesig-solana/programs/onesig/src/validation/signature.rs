use std::collections::HashSet;

use anchor_lang::prelude::*;
use solana_keccak_hasher as keccak;
use solana_secp256k1_recover::secp256k1_recover;

use crate::{
    constants::*,
    errors::*,
    types::{Address, Hash, Secp256k1Pubkey, Signature},
};

pub struct SignatureValidator;

impl SignatureValidator {
    /// Verifies that a registered signer authorized `delegate` to execute `leaf`
    /// within `expiry`, **as part of the operator-approved batch identified by
    /// `merkle_root`**.
    pub fn verify_signer_execution_proof(
        leaf: &Hash,
        merkle_root: &Hash,
        delegate: Pubkey,
        expiry: u64,
        signers: &[Address],
        signature: &Signature,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!((now as u64) <= expiry, OneSigError::ExpiredSignerExecutionProof);

        let authorization_digest =
            build_signer_execution_authorization_digest(leaf, merkle_root, &delegate, expiry);

        let recovered: Address = Self::recover_signer(&authorization_digest, signature)?.into();
        require!(signers.contains(&recovered), OneSigError::SignerExecutionProofUnauthorized);
        Ok(())
    }

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

// EIP-712 signer-as-executor authorization digest:
//   structHash            = keccak256(
//       SIGNER_EXECUTION_AUTHORIZATION_TYPE_HASH || leafHash || merkleRoot ||
//       keccak256(delegate) || expiry_padded
//   )
//   authorization_digest  = keccak256(0x1901 || DOMAIN_SEPARATOR || structHash)
//
// Uses the canonical OneSig domain (the same `DOMAIN_SEPARATOR` as merkle-root
// signatures);
//
// `merkleRoot` pins the authorization to one operator-approved batch so the delegate
// cannot pick a different root that happens to contain the same leaf. `expiry` is
// ABI-encoded as uint256 (32 bytes, left zero-padded).
pub(crate) fn build_signer_execution_authorization_digest(
    leaf: &Hash,
    merkle_root: &Hash,
    delegate: &Pubkey,
    expiry: u64,
) -> Hash {
    let delegate_hash = keccak::hash(delegate.as_ref());
    let mut expiry_padded = [0u8; 32];
    expiry_padded[24..].copy_from_slice(&expiry.to_be_bytes());
    let struct_hash = keccak::hashv(&[
        &SIGNER_EXECUTION_AUTHORIZATION_TYPE_HASH,
        leaf.as_ref(),
        merkle_root.as_ref(),
        delegate_hash.as_ref(),
        &expiry_padded,
    ]);
    keccak::hashv(&[&EIP191_PREFIX_FOR_EIP712, &DOMAIN_SEPARATOR, struct_hash.as_ref()]).into()
}
