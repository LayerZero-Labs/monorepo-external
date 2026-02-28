// Tests for verifying Merkle proof implementation in Solana matches EVM behavior.
//
// These tests ensure that:
// 1. Merkle proof verification works correctly in Solana environment
// 2. Transaction Merkle proofs are verified consistently across chains
// 3. Merkle root signature verification works the same way as in EVM
//
// The test uses hardcoded values from EVM tests (packages/onesig-evm/test/hardhat/one-sig.test.ts)
// to verify cross-chain compatibility. To obtain these values, add these console.log
// statements in EVM tests:
// ```typescript
// console.log('signers:', sortedSigners.map((s) => s.publicKey))
// console.log('seed', SEED)
// console.log('expiry', expiry)
// console.log('signatures:', signatures)
// console.log('leaf', leafEncode(leaves[0]))
// console.log('proof', proof)
// console.log('merkleRoot', merkleRoot.toString('hex'))
// ```
#[cfg(test)]
mod tests {

    use anchor_lang::prelude::Pubkey;

    use crate::{
        state::{Multisig, OneSigState},
        types::{Hash, OneSigAccountMeta, OneSigInstruction},
        validation::merkle::MerkleValidator,
        Address, Executors, OneSigError, Secp256k1Pubkey,
    };

    // Test fixture struct for MerkleRoot verification tests
    struct MerkleRootTestFixture {
        expiry: i64,
        signatures: Vec<u8>,
        merkle_root: Hash,
        state: OneSigState,
    }

    // Test fixture struct for MerkleProof verification tests
    struct MerkleProofTestFixture {
        proof: Vec<Hash>,
        merkle_root: Hash,
        leaf: Hash,
    }

    // Helper function to create a default MerkleRootTestFixture
    fn create_merkle_root_fixture() -> MerkleRootTestFixture {
        let signers: Vec<Address> = vec![
            Secp256k1Pubkey::try_from(hex::decode("4c0346927a164fe5d37c5ff73ab31f2ed2416a5679b172477fd1aefb331fa72bc08a10c9a84d21289f8b63244c7b3d73cfb2ef18ad22455937341adfddbd305d")
                .unwrap()).expect("slice with incorrect length").into(),
            Secp256k1Pubkey::try_from(hex::decode("fea2a7c50de763bbaaeaf5452eb2412fde3f0610f4be4b1cdb160460f51d9b6c869e5fb895cb15485224977c7e737fb25d4ca1ebb88268d67fb8a9ad79814ed7")
                .unwrap()).expect("slice with incorrect length").into(),
        ];
        let seed = hex::decode("76cc1c7d586cee3a5ae8ff4bab4299354dbba2c59176d79b744ba0a1ce5336fa")
            .unwrap();
        let expiry = 1741622488;
        let signatures = hex::decode("31537dcfe1ec4d7e89f5972ccd3065e34e178e302c1b9e8e175d3843a2964f2863f2b60c7ef74363b687f822db6c313e8762b38d3097b6fec9b7b76165630aaa1b042674fc630e32f9000bc95271ec54283c8ad350016bb66a18464958963a51f3146e8b3fbb3a5bd0b89d3b6c1e01dd614e86bae01351dc3d1ffe3522c83ed4501c")
            .unwrap();
        let merkle_root: Hash =
            hex::decode("9c8e2403d4f1269e83ce128f2265631b22be6327cca2ede7776da9f8db2a9afc")
                .unwrap()
                .try_into()
                .expect("slice with incorrect length");

        let state = OneSigState {
            seed: seed.clone().try_into().unwrap(),
            one_sig_id: 900,
            bump: 0,
            nonce: 1,
            multisig: Multisig { signers: signers.clone(), threshold: 2 },
            executors: Executors { executors: vec![], executor_required: false },
        };

        MerkleRootTestFixture { expiry, signatures, merkle_root, state }
    }

    // Helper function to create a default MerkleProofTestFixture
    fn create_merkle_proof_fixture() -> MerkleProofTestFixture {
        let proof: Vec<Hash> = vec![
            hex::decode("c83f6f23f70097d27d2c5f3881632259151032aceddf5467ffc004e9bfc1b74e")
                .unwrap()
                .try_into()
                .expect("slice with incorrect length"),
            hex::decode("63e335f61023ed89b955c0ee077806ffbdace5c6930e57967d183e10c225e7eb")
                .unwrap()
                .try_into()
                .expect("slice with incorrect length"),
        ];
        let merkle_root =
            hex::decode("9c8e2403d4f1269e83ce128f2265631b22be6327cca2ede7776da9f8db2a9afc")
                .unwrap()
                .try_into()
                .unwrap();
        let leaf = hex::decode("fdcc354b818ad1de1e3be454bac1ca27100f245ac7ce99ef26d4d7746b05f4f7")
            .unwrap()
            .try_into()
            .unwrap();

        MerkleProofTestFixture { proof, merkle_root, leaf }
    }

    #[test]
    fn test_verify_merkle_root() {
        let fixture = create_merkle_root_fixture();
        let current_timestamp = 0;

        assert!(MerkleValidator::verify_merkle_root(
            &fixture.state,
            &fixture.merkle_root,
            fixture.expiry,
            &fixture.signatures,
            current_timestamp,
        )
        .is_ok());
    }

    #[test]
    fn test_verify_merkle_proof() {
        let fixture = create_merkle_proof_fixture();

        assert!(MerkleValidator::verify_merkle_proof(
            &fixture.merkle_root,
            &fixture.proof,
            &fixture.leaf
        )
        .is_ok());
    }

    #[test]
    fn test_verify_merkle_root_expired() {
        let fixture = create_merkle_root_fixture();

        // Set current_timestamp to be greater than expiry to trigger expiration error
        let current_timestamp = fixture.expiry + 1;
        let result = MerkleValidator::verify_merkle_root(
            &fixture.state,
            &fixture.merkle_root,
            fixture.expiry,
            &fixture.signatures,
            current_timestamp,
        );

        assert_eq!(result.unwrap_err(), OneSigError::ExpiredMerkleRoot.into());
    }

    #[test]
    fn test_verify_merkle_root_invalid_signatures() {
        let fixture = create_merkle_root_fixture();

        // Corrupt the signature by changing some bytes
        let mut invalid_signatures = fixture.signatures.clone();
        invalid_signatures[10] = invalid_signatures[10].wrapping_add(1); // Modify a byte in the first signature

        let current_timestamp = 0;
        let result = MerkleValidator::verify_merkle_root(
            &fixture.state,
            &fixture.merkle_root,
            fixture.expiry,
            &invalid_signatures,
            current_timestamp,
        );

        assert_eq!(result.unwrap_err(), OneSigError::FailedSignatureRecovery.into());
    }

    #[test]
    fn test_verify_merkle_proof_invalid() {
        let fixture = create_merkle_proof_fixture();

        // Use an incorrect leaf hash that won't produce the expected Merkle root
        let invalid_leaf =
            hex::decode("0000354b818ad1de1e3be454bac1ca27100f245ac7ce99ef26d4d7746b05f4f7")
                .unwrap()
                .try_into()
                .unwrap();

        let result = MerkleValidator::verify_merkle_proof(
            &fixture.merkle_root,
            &fixture.proof,
            &invalid_leaf,
        );

        assert_eq!(result.unwrap_err(), OneSigError::InvalidProof.into());
    }

    #[test]
    fn test_encode_instruction_capacity() {
        let num_accounts = 10;
        let data_size = 100;

        // Create dummy program ID
        let program_id = Pubkey::new_unique();

        // Create dummy accounts
        let accounts = (0..num_accounts)
            .map(|i| {
                let is_signer = i % 2 == 0;
                let is_writable = i % 3 == 0;
                OneSigAccountMeta { pubkey: Pubkey::new_unique(), is_signer, is_writable }
            })
            .collect::<Vec<_>>();

        // Create dummy data
        let data = vec![0u8; data_size];

        // Create OneSigInstruction
        let onesig_instruction = OneSigInstruction { program_id, accounts, data, value: 123 };

        // Get the size of the serialized data
        let encoded = MerkleValidator::encode_instruction(&onesig_instruction).unwrap();

        // Calculate expected capacity
        let expected_capacity =
            48 + onesig_instruction.accounts.len() * 34 + onesig_instruction.data.len();

        // The actual serialized size should be equal to our capacity calculation
        assert!(
            encoded.len() == expected_capacity,
            "Encoded size {} exceeds capacity calculation {} for {} accounts and {} data bytes",
            encoded.len(),
            expected_capacity,
            num_accounts,
            data_size
        );
    }
}
