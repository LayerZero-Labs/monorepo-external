use soroban_sdk::{BytesN, Env, U256};
use utils::buffer_writer::BufferWriter;

/// Both merkle-root signatures and signer proofs use EIP-712 typed structured
/// data. The 0x1901 prefix is the EIP-712 magic bytes that prevent signed
/// messages from being confused with raw Ethereum transactions.
const EIP191_PREFIX_FOR_EIP712: [u8; 2] = [0x19, 0x01];

/// keccak256("SignMerkleRoot(bytes32 seed,bytes32 merkleRoot,uint256 expiry)")
const SIGN_MERKLE_ROOT_TYPE_HASH: [u8; 32] = [
    0x64, 0x2e, 0xd5, 0xd2, 0xb7, 0x7b, 0xc7, 0xcc, 0xb9, 0x8e, 0x10, 0xda, 0x4c, 0x02, 0xd7, 0xcd,
    0x82, 0x31, 0x22, 0x8d, 0xa4, 0x22, 0x2a, 0x9f, 0x88, 0xa8, 0x0c, 0x15, 0x54, 0x50, 0x74, 0xed,
];

/// keccak256("SignerProof(bytes32 leafHash,bytes32 merkleRoot,bytes delegate,uint64 signerProofExpiry)")
const SIGNER_PROOF_TYPE_HASH: [u8; 32] = [
    0x16, 0x53, 0x87, 0x2b, 0x01, 0x12, 0x6b, 0x12, 0x14, 0x4c, 0x16, 0x50, 0x72, 0x69, 0x12, 0x14,
    0x68, 0xed, 0x60, 0x89, 0xbb, 0x6b, 0x4b, 0x67, 0x90, 0x94, 0x7b, 0xd3, 0x7f, 0x54, 0x0e, 0xfc,
];

/// keccak256(domainTypeHash || keccak256("OneSig") || keccak256("1"))
/// where domainTypeHash = keccak256("EIP712Domain(string name,string version)")
const SIGNER_PROOF_DOMAIN_SEPARATOR: [u8; 32] = [
    0x95, 0xc6, 0xb2, 0x72, 0xa7, 0x6a, 0x26, 0x97, 0xaa, 0xe0, 0xeb, 0xbe, 0xba, 0x82, 0x3d, 0xf9,
    0xfa, 0x62, 0x72, 0xc9, 0xcc, 0x0e, 0xca, 0xf3, 0xf3, 0x14, 0xe5, 0xb1, 0xea, 0x89, 0xf4, 0x0b,
];

/// Pre-computed EIP-712 domain separator for merkle-root signing
/// keccak256(abi.encode(EIP712DOMAIN_TYPE_HASH, keccak256("OneSig"), keccak256("0.0.1"), 1, 0xdEaD))
const EIP712_DOMAIN_SEPARATOR: [u8; 32] = [
    0x94, 0xc2, 0x89, 0x89, 0x17, 0x0e, 0xb4, 0xdc, 0x31, 0x35, 0x91, 0x74, 0xb9, 0x11, 0x5c, 0x11,
    0x6a, 0x8f, 0xaf, 0xa6, 0x7b, 0x5a, 0xda, 0xcc, 0x57, 0x0c, 0xa5, 0x83, 0xeb, 0x96, 0xd6, 0x57,
];

/// Computes the EIP-712 style digest for merkle root verification
///
/// # Arguments
/// * `env` - The Soroban environment
/// * `seed` - The seed value for this OneSig instance
/// * `merkle_root` - The merkle root to sign
/// * `expiry` - The expiry timestamp
///
/// # Returns
/// The 32-byte digest hash to be signed
pub fn build_eip712_digest(
    env: &Env,
    seed: &BytesN<32>,
    merkle_root: &BytesN<32>,
    expiry: u64,
) -> BytesN<32> {
    // Build payload: keccak256(abi.encode(SIGN_MERKLE_ROOT_TYPE_HASH, seed, merkleRoot, expiry))
    // According to EIP-712 and Solidity's abi.encode, the encoding is:
    // typeHash (32 bytes) || seed (32 bytes) || merkleRoot (32 bytes) || expiry (32 bytes as uint256)
    let mut payload_writer = BufferWriter::new(env);
    let payload = payload_writer
        .write_array(&SIGN_MERKLE_ROOT_TYPE_HASH) // Type hash (32 bytes)
        .write_bytes_n(seed) // Seed (32 bytes)
        .write_bytes_n(merkle_root) // Merkle root (32 bytes)
        .write_u256(U256::from_u128(env, expiry as u128)) // Expiry (32 bytes as uint256)
        .to_bytes();
    // Hash payload (returns Hash<32>)
    // This is the structHash: keccak256(typeHash || encodeData(struct))
    let payload_hash = env.crypto().keccak256(&payload);

    // Build digest: keccak256(EIP191_PREFIX || DOMAIN_SEPARATOR || payload_hash)
    // According to EIP-712: keccak256(0x19 || 0x01 || domainSeparator || structHash)
    let mut digest_writer = BufferWriter::new(env);
    let digest_data = digest_writer
        .write_array(&EIP191_PREFIX_FOR_EIP712) // EIP-191 prefix (2 bytes)
        .write_array(&EIP712_DOMAIN_SEPARATOR) // Domain separator (32 bytes)
        .write_array(&payload_hash.to_array()) // Payload hash (32 bytes)
        .to_bytes();
    env.crypto().keccak256(&digest_data).into()
}

/// Computes the EIP-712 digest for the signer-as-executor proof.
///
/// Domain: { name: "OneSig", version: "1" }
/// Type:   SignerProof(bytes32 leafHash, bytes32 merkleRoot, bytes delegate, uint64 signerProofExpiry)
///
/// digest = keccak256(0x1901 || SIGNER_PROOF_DOMAIN_SEPARATOR || structHash)
/// where:
///   structHash = keccak256(
///       SIGNER_PROOF_TYPE_HASH || leafHash || merkleRoot ||
///       keccak256(delegate) || signerProofExpiry
///   )
///
/// `merkleRoot` pins the proof to one operator-approved batch — required because the
/// same leaf can appear in multiple active roots, and without binding the delegate
/// (not the signer) would choose which root carries the execution.
///
/// `delegate` is encoded as `keccak256(delegate)` because it is a dynamic `bytes` type
/// in EIP-712. `signerProofExpiry` is ABI-encoded as uint64 (32 bytes, left zero-padded).
pub fn build_signer_proof_digest(
    env: &Env,
    leaf_hash: &BytesN<32>,
    merkle_root: &BytesN<32>,
    delegate: &BytesN<32>,
    signer_proof_expiry: u64,
) -> BytesN<32> {
    // structHash = keccak256(typeHash || leafHash || merkleRoot || keccak256(delegate) || signerProofExpiry)
    // `delegate` is a dynamic `bytes` type in EIP-712, so it is encoded as keccak256(delegate).
    let delegate_hash = env.crypto().keccak256(&delegate.clone().into());
    let struct_hash = env.crypto().keccak256(
        &BufferWriter::new(env)
            .write_array(&SIGNER_PROOF_TYPE_HASH)
            .write_bytes_n(leaf_hash)
            .write_bytes_n(merkle_root)
            .write_array(&delegate_hash.to_array())
            .write_u256(U256::from_u128(env, signer_proof_expiry as u128))
            .to_bytes(),
    );

    // digest = keccak256(0x1901 || domainSeparator || structHash)
    env.crypto()
        .keccak256(
            &BufferWriter::new(env)
                .write_array(&EIP191_PREFIX_FOR_EIP712)
                .write_array(&SIGNER_PROOF_DOMAIN_SEPARATOR)
                .write_array(&struct_hash.to_array())
                .to_bytes(),
        )
        .into()
}

#[cfg(test)]
mod tests {
    use super::{
        build_signer_proof_digest, BufferWriter, EIP712_DOMAIN_SEPARATOR,
        SIGNER_PROOF_DOMAIN_SEPARATOR, SIGNER_PROOF_TYPE_HASH, SIGN_MERKLE_ROOT_TYPE_HASH,
    };
    use soroban_sdk::{Bytes, BytesN, Env, U256};

    fn keccak(env: &Env, input: &[u8]) -> [u8; 32] {
        env.crypto()
            .keccak256(&Bytes::from_slice(env, input))
            .to_array()
    }

    #[test]
    fn test_sign_merkle_root_type_hash_matches_source_string() {
        let env = Env::default();

        let computed = keccak(
            &env,
            b"SignMerkleRoot(bytes32 seed,bytes32 merkleRoot,uint256 expiry)",
        );

        assert_eq!(computed, SIGN_MERKLE_ROOT_TYPE_HASH);
    }

    #[test]
    fn test_eip712_domain_separator_matches_formula() {
        let env = Env::default();

        let type_hash = keccak(
            &env,
            b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
        );
        let name_hash = keccak(&env, b"OneSig");
        let version_hash = keccak(&env, b"0.0.1");

        // Solidity ABI-encoding for address is 32 bytes, left padded.
        let mut verifying_contract = [0u8; 32];
        verifying_contract[30] = 0xde;
        verifying_contract[31] = 0xad;

        let encoded = BufferWriter::new(&env)
            .write_array(&type_hash)
            .write_array(&name_hash)
            .write_array(&version_hash)
            .write_u256(U256::from_u128(&env, 1u128))
            .write_array(&verifying_contract)
            .to_bytes();

        let computed = env.crypto().keccak256(&encoded).to_array();
        assert_eq!(computed, EIP712_DOMAIN_SEPARATOR);
    }

    #[test]
    fn test_signer_proof_type_hash_matches_source_string() {
        let env = Env::default();
        let computed = keccak(
            &env,
            b"SignerProof(bytes32 leafHash,bytes32 merkleRoot,bytes delegate,uint64 signerProofExpiry)",
        );
        assert_eq!(computed, SIGNER_PROOF_TYPE_HASH);
    }

    #[test]
    fn test_signer_proof_domain_separator_matches_formula() {
        let env = Env::default();
        let domain_type_hash = keccak(&env, b"EIP712Domain(string name,string version)");
        let name_hash = keccak(&env, b"OneSig");
        let version_hash = keccak(&env, b"1");
        let mut encoded = [0u8; 96];
        encoded[0..32].copy_from_slice(&domain_type_hash);
        encoded[32..64].copy_from_slice(&name_hash);
        encoded[64..96].copy_from_slice(&version_hash);
        let computed = keccak(&env, &encoded);
        assert_eq!(computed, SIGNER_PROOF_DOMAIN_SEPARATOR);
    }

    #[test]
    fn test_build_signer_proof_digest_matches_manual_eip712_computation() {
        let env = Env::default();

        let leaf_hash = BytesN::from_array(&env, &[0xAAu8; 32]);
        let merkle_root = BytesN::from_array(&env, &[0xCCu8; 32]);
        let delegate = BytesN::from_array(&env, &[0xBBu8; 32]);
        let signer_proof_expiry: u64 = 0x0123_4567_89AB_CDEF;

        // domainSeparator
        let domain_type_hash = keccak(&env, b"EIP712Domain(string name,string version)");
        let name_hash = keccak(&env, b"OneSig");
        let version_hash = keccak(&env, b"1");
        let mut domain_encoded = [0u8; 96];
        domain_encoded[0..32].copy_from_slice(&domain_type_hash);
        domain_encoded[32..64].copy_from_slice(&name_hash);
        domain_encoded[64..96].copy_from_slice(&version_hash);
        let domain_separator = keccak(&env, &domain_encoded);

        // structHash: keccak256(typeHash || leafHash || merkleRoot || keccak256(delegate) || expiry as uint64)
        let type_hash = keccak(
            &env,
            b"SignerProof(bytes32 leafHash,bytes32 merkleRoot,bytes delegate,uint64 signerProofExpiry)",
        );
        let delegate_hash = keccak(&env, &delegate.to_array());
        let mut expiry_padded = [0u8; 32];
        expiry_padded[24..32].copy_from_slice(&signer_proof_expiry.to_be_bytes());
        let mut struct_data = [0u8; 32 * 5];
        struct_data[0..32].copy_from_slice(&type_hash);
        struct_data[32..64].copy_from_slice(&leaf_hash.to_array());
        struct_data[64..96].copy_from_slice(&merkle_root.to_array());
        struct_data[96..128].copy_from_slice(&delegate_hash);
        struct_data[128..160].copy_from_slice(&expiry_padded);
        let struct_hash = keccak(&env, &struct_data);

        // digest: keccak256(0x1901 || domainSeparator || structHash)
        let mut digest_data = [0u8; 2 + 32 + 32];
        digest_data[0] = 0x19;
        digest_data[1] = 0x01;
        digest_data[2..34].copy_from_slice(&domain_separator);
        digest_data[34..66].copy_from_slice(&struct_hash);
        let expected = keccak(&env, &digest_data);

        let computed = build_signer_proof_digest(
            &env,
            &leaf_hash,
            &merkle_root,
            &delegate,
            signer_proof_expiry,
        );
        assert_eq!(computed.to_array(), expected);
    }
}
