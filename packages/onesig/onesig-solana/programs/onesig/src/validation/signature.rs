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
        let now = Clock::get()?.unix_timestamp as u64;
        require!(now <= expiry, OneSigError::ExpiredSignerExecutionProof);

        let authorization_digest =
            build_signer_execution_authorization_digest(leaf, merkle_root, &delegate, expiry);

        let recovered: Address = Self::recover_signer(&authorization_digest, signature)?.into();
        require!(signers.contains(&recovered), OneSigError::SignerExecutionProofUnauthorized);
        Ok(())
    }

    // Verifies multiple signatures against the signer list and threshold. Each recovered address
    // must be a registered signer, and duplicates are rejected, so the recovered count is the
    // number of distinct signers that authorized `digest`.
    pub fn verify_n_signatures(
        threshold: u8,
        signers: &[Address],
        digest: &Hash,
        signatures: &[u8],
    ) -> Result<()> {
        require!(threshold > 0, OneSigError::InvalidThreshold);
        require!(
            signatures.len().is_multiple_of(SIGNATURE_BYTES_LEN),
            OneSigError::SignatureDataSizeMismatch
        );
        require!(
            signatures.len() / SIGNATURE_BYTES_LEN >= threshold as usize,
            OneSigError::InsufficientSignatures
        );

        // Vec instead of HashSet: bounded linear scan (SIGNERS_MAX_LEN = 50), avoids HashSet
        // overhead in a no_std-friendly context, and preserves signature order for determinism.
        let mut recovered_signers = Vec::with_capacity(signatures.len() / SIGNATURE_BYTES_LEN);
        for chunk_signature in signatures.chunks(SIGNATURE_BYTES_LEN) {
            let signature: &Signature = &chunk_signature.try_into()?;
            let recovered_signer = SignatureValidator::recover_signer(digest, signature)?;
            let recovered_address = recovered_signer.into();

            require!(signers.contains(&recovered_address), OneSigError::SignerNotFound);
            require!(!recovered_signers.contains(&recovered_address), OneSigError::AlreadyAdded);
            recovered_signers.push(recovered_address);
        }

        Ok(())
    }

    // Recovers the signer public key from a signature
    fn recover_signer(digest: &Hash, signature: &Signature) -> Result<Secp256k1Pubkey> {
        let (recovery_id, signature_r_s) = signature.split_recovery_id();

        // Reject malleable high-S signatures. `secp256k1_recover` accepts both `s` and `n - s`, so
        // without this an attacker can produce a second valid encoding of any signature. Enforcing
        // low-S (`s <= n/2`) matches EVM's `ECDSA.tryRecover` and keeps signatures canonical and
        // cross-chain consistent. `signature_r_s` is `r(32) || s(32)`.
        require!(signature_r_s[32..] <= SECP256K1_HALF_ORDER[..], OneSigError::MalleableSignature);

        // Ethereum's `ecrecover` encodes the recovery id as v = recovery_id + 27, so accept v in
        // 27..=28 and normalize back to the secp256k1 recovery id 0..=1.
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
// signatures).
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
