use anchor_lang::{
    prelude::{borsh::BorshSerialize, *},
    solana_program::keccak,
};

use super::signature::SignatureValidator;
use crate::{
    constants::*,
    errors::OneSigError,
    state::OneSigState,
    types::{Hash, OneSigInstruction},
};

pub struct MerkleValidator;

impl MerkleValidator {
    /// Verifies Merkle root expiry and signatures
    pub fn verify_merkle_root(
        one_sig_state: &OneSigState,
        merkle_root: &Hash,
        expiry: i64,
        signatures: &[u8],
        current_timestamp: i64,
    ) -> Result<()> {
        require!(expiry >= current_timestamp, OneSigError::ExpiredMerkleRoot);

        let expiry_u128: u128 = expiry.try_into().unwrap();
        // Build EIP-712 style digest
        let digest = keccak::hashv(&[
            &EIP191_PREFIX_FOR_EIP712,
            &DOMAIN_SEPARATOR,
            keccak::hashv(&[
                SIGN_MERKLE_ROOT_TYPE_HASH.as_ref(),
                one_sig_state.seed.as_ref(),
                merkle_root.as_ref(),
                &0u128.to_be_bytes(),       // high bytes of uint256
                &expiry_u128.to_be_bytes(), // low bytes of uint256
            ])
            .as_ref(),
        ]);

        // Verify multisig signatures on digest
        SignatureValidator::verify_signatures(
            one_sig_state.multisig.threshold,
            &one_sig_state.multisig.signers,
            &digest.into(),
            signatures,
        )
    }

    pub fn verify_merkle_proof(merkle_root: &Hash, proof: &[Hash], leaf: &Hash) -> Result<()> {
        let mut computed_hash = *leaf;

        // Apply proof elements in order
        for p in proof.iter() {
            computed_hash = if computed_hash < *p {
                keccak::hashv(&[computed_hash.as_ref(), p.as_ref()]).into()
            } else {
                keccak::hashv(&[p.as_ref(), computed_hash.as_ref()]).into()
            };
        }

        // Verify computed root matches expected
        require!(computed_hash == *merkle_root, OneSigError::InvalidProof);
        Ok(())
    }

    // Encodes transaction leaf hash from state and instruction
    pub fn encode_leaf(
        one_sig_state: &Pubkey,
        one_sig_id: u64,
        nonce: u64,
        instruction: &OneSigInstruction,
    ) -> Result<Hash> {
        let encoded_instruction = MerkleValidator::encode_instruction(instruction)?;
        let nonce_bytes = nonce.to_be_bytes();
        let one_sig_id_bytes = one_sig_id.to_be_bytes();

        let leaf_data = vec![
            MERKLE_LEAF_ENCODING_VERSION.as_ref(),
            one_sig_id_bytes.as_ref(),
            one_sig_state.as_ref(),
            nonce_bytes.as_ref(),
            encoded_instruction.as_ref(),
        ];

        Ok(keccak::hash(keccak::hashv(&leaf_data).as_ref()).into())
    }

    pub fn encode_instruction(instruction: &OneSigInstruction) -> Result<Vec<u8>> {
        // Capacity calculation breakdown:
        //    48 + instruction.accounts.len() * 34 + instruction.data.len()
        //
        // 1. 48 bytes of fixed overhead:
        //    - program_id: Pubkey - 32 bytes (from Instruction struct)
        //    - Vec serialization overhead - 4 bytes (for accounts vector length prefix)
        //    - Vec serialization overhead - 4 bytes (for data vector length prefix)
        //    - u64 value - 8 bytes (from the OneSigInstruction tuple)
        //
        // 2. ix.accounts.len() * 34:
        //    - Each AccountMeta in Borsh serialization takes 34 bytes:
        //      * pubkey: Pubkey - 32 bytes (standard size of Solana public key)
        //      * is_signer: bool - 1 byte
        //      * is_writable: bool - 1 byte
        //
        // 3. ix.data.len():
        //    - The actual instruction data bytes
        //
        // This pre-allocation ensures the Vec has sufficient capacity for all serialized data,
        // avoiding multiple reallocations during serialization, thus improving performance.
        let mut encoded_data: Vec<u8> =
            Vec::with_capacity(48 + instruction.accounts.len() * 34 + instruction.data.len());
        instruction.serialize(&mut encoded_data)?;
        Ok(encoded_data)
    }
}
