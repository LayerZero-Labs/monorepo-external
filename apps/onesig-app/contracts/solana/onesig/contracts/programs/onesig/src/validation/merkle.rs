use anchor_lang::prelude::{borsh::BorshSerialize, *};
use solana_keccak_hasher as keccak;

use super::signature::SignatureValidator;
use crate::{
    constants::*,
    errors::OneSigError,
    state::OneSigState,
    types::{Hash, OneSigInstruction},
};

pub struct MerkleValidator;

impl MerkleValidator {
    /// Verifies Merkle root expiry and signatures against the threshold.
    pub fn verify_merkle_root(
        one_sig_state: &OneSigState,
        merkle_root: &Hash,
        expiry: u64,
        signatures: &[u8],
        current_timestamp: u64,
    ) -> Result<()> {
        require!(expiry >= current_timestamp, OneSigError::MerkleRootExpired);
        let digest = build_merkle_root_digest(merkle_root, &one_sig_state.seed, expiry);
        SignatureValidator::verify_n_signatures(
            one_sig_state.multisig.threshold,
            &one_sig_state.multisig.signers,
            &digest,
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

    // Encodes a transaction leaf hash for one or more instructions.
    // Header fields (one_sig_id, nonce) are big-endian to match the onesig leaf encoding standard
    // (analogous to EVM abi.encode), not Borsh little-endian. Instructions are Borsh-serialized
    // and appended in execution order, so reordering them changes the leaf hash.
    pub fn encode_leaf(
        one_sig_state: &Pubkey,
        one_sig_id: u64,
        nonce: u64,
        instructions: &[OneSigInstruction],
    ) -> Result<Hash> {
        require!(!instructions.is_empty(), OneSigError::InvalidExecuteParams);

        let nonce_bytes: [u8; 8] = nonce.to_be_bytes();
        let one_sig_id_bytes = one_sig_id.to_be_bytes();

        let encoded_instructions = instructions
            .iter()
            .map(MerkleValidator::encode_instruction)
            .collect::<Result<Vec<_>>>()?;

        let mut leaf_data = Vec::with_capacity(4 + encoded_instructions.len());
        leaf_data.push(MERKLE_LEAF_ENCODING_VERSION.as_ref());
        leaf_data.push(one_sig_id_bytes.as_ref());
        leaf_data.push(one_sig_state.as_ref());
        leaf_data.push(nonce_bytes.as_ref());
        leaf_data.extend(encoded_instructions.iter().map(Vec::as_slice));

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

// EIP-712 digest for SignMerkleRoot. `expiry` is a u64 Unix timestamp on Solana; its big-endian
// bytes are left-padded with 24 zero bytes to occupy the EIP-712 uint256 slot:
//   structHash = keccak256(SIGN_MERKLE_ROOT_TYPE_HASH || seed || merkleRoot || uint256(expiry))
//   digest = keccak256(EIP191_PREFIX_FOR_EIP712 || DOMAIN_SEPARATOR || structHash)
fn build_merkle_root_digest(merkle_root: &Hash, seed: &Hash, expiry: u64) -> Hash {
    let expiry_u128 = u128::from(expiry);
    keccak::hashv(&[
        &EIP191_PREFIX_FOR_EIP712,
        &DOMAIN_SEPARATOR,
        keccak::hashv(&[
            SIGN_MERKLE_ROOT_TYPE_HASH.as_ref(),
            seed.as_ref(),
            merkle_root.as_ref(),
            &0u128.to_be_bytes(),       // high bytes of uint256
            &expiry_u128.to_be_bytes(), // low bytes of uint256
        ])
        .as_ref(),
    ])
    .into()
}
