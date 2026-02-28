// Tests for verifying Secp256k1 signature validation in the Solana program.
//
// These tests ensure that:
// 1. Signatures from authorized signers can be properly verified
// 2. Signature validation fails correctly with invalid inputs
// 3. The threshold validation logic works as expected
// 4. Signatures are properly sorted and validated
//
// The test uses hardcoded values from EVM tests (packages/onesig-evm/test/hardhat/one-sig.test.ts)
// to verify cross-chain compatibility. To obtain these values, add these console.log
// statements in EVM tests:
// ```typescript
// console.log('signers:', sortedSigners.map((s) => s.publicKey))
// console.log('signatures:', signatures)
// ```
#[cfg(test)]
mod tests {
    use anchor_lang::solana_program::secp256k1_recover::SECP256K1_PUBLIC_KEY_LENGTH;

    use crate::{
        constants::SIGNATURE_BYTES_LEN, validation::signature::SignatureValidator, Address, Hash,
        OneSigError, Secp256k1Pubkey,
    };

    // Test fixture struct to avoid duplicating test data
    struct TestFixture {
        signers: Vec<Address>,
        threshold: u8,
        digest: Hash,
        signatures: Vec<u8>,
    }

    // Helper function to create a default test fixture
    fn create_test_fixture() -> TestFixture {
        let signers = vec![
            Secp256k1Pubkey::try_from(hex::decode("4c0346927a164fe5d37c5ff73ab31f2ed2416a5679b172477fd1aefb331fa72bc08a10c9a84d21289f8b63244c7b3d73cfb2ef18ad22455937341adfddbd305d")
                .unwrap()).expect("slice with incorrect length").into(),
            Secp256k1Pubkey::try_from(hex::decode("fea2a7c50de763bbaaeaf5452eb2412fde3f0610f4be4b1cdb160460f51d9b6c869e5fb895cb15485224977c7e737fb25d4ca1ebb88268d67fb8a9ad79814ed7")
                .unwrap()).expect("slice with incorrect length").into(),
        ];
        let threshold = 2;
        let digest =
            hex::decode("7d84fd508a27ac81dee4bfa97f29bedb885c1bd7fc4650f491e64fbdaa05cdac")
                .unwrap();
        let signatures = hex::decode("31537dcfe1ec4d7e89f5972ccd3065e34e178e302c1b9e8e175d3843a2964f2863f2b60c7ef74363b687f822db6c313e8762b38d3097b6fec9b7b76165630aaa1b042674fc630e32f9000bc95271ec54283c8ad350016bb66a18464958963a51f3146e8b3fbb3a5bd0b89d3b6c1e01dd614e86bae01351dc3d1ffe3522c83ed4501c")
            .unwrap();

        TestFixture { signers, threshold, digest: digest.try_into().unwrap(), signatures }
    }

    #[test]
    fn test_verify_signatures() {
        let fixture = create_test_fixture();

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            &fixture.signatures,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_signatures_invalid_signer() {
        // Test case where signature format is invalid or can't be recovered
        let fixture = create_test_fixture();

        // Corrupt the signature by changing the recovery ID byte
        let mut invalid_signatures = fixture.signatures.clone();
        invalid_signatures[64] = 0xFF; // Invalid recovery ID

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            &invalid_signatures,
        );

        assert_eq!(result.unwrap_err(), OneSigError::FailedSignatureRecovery.into());
    }

    #[test]
    fn test_verify_signatures_too_many_signers() {
        // Test case where there are more signatures than threshold
        let mut fixture = create_test_fixture();

        // Only requiring 1 signature but providing 2 signatures
        fixture.threshold = 1;

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            &fixture.signatures,
        );

        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_signatures_too_few_signers() {
        // Test case where there are fewer signatures than threshold
        let mut fixture = create_test_fixture();

        // Requiring 3 signatures but providing only 2
        fixture.threshold = 3;

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            &fixture.signatures,
        );

        assert_eq!(result.unwrap_err(), OneSigError::InsufficientSignatures.into());
    }

    #[test]
    fn test_verify_signatures_signer_not_found() {
        // Test case where a signature is from a signer not in the authorized list
        let mut fixture = create_test_fixture();

        // Replace the second signer with a different one that doesn't match the signature
        fixture.signers = vec![
            fixture.signers[0], // Keep the first valid signer
            Secp256k1Pubkey::new(&[1; SECP256K1_PUBLIC_KEY_LENGTH]).into(), // Different signer
        ];

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            &fixture.signatures,
        );

        assert_eq!(result.unwrap_err(), OneSigError::MissingSigner.into());
    }

    #[test]
    fn test_verify_signatures_duplicate_signers() {
        // Test case where the same signature appears twice
        let fixture = create_test_fixture();

        // Create signatures array with duplicated signatures
        let mut duplicate_signatures = Vec::with_capacity(fixture.signatures.len());

        // Add the first signature chunk twice (first signer duplicated)
        duplicate_signatures.extend_from_slice(&fixture.signatures[0..SIGNATURE_BYTES_LEN]);
        duplicate_signatures.extend_from_slice(&fixture.signatures[0..SIGNATURE_BYTES_LEN]);

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            &duplicate_signatures,
        );

        assert_eq!(result.unwrap_err(), OneSigError::DuplicateSigners.into());
    }

    // Add a new test to verify signatures in different order
    #[test]
    fn test_verify_signatures_out_of_order() {
        // Test case where signatures are in a different order than the signers array
        let fixture = create_test_fixture();

        // Reverse the signature order (if there are multiple signatures)
        let mut reversed_signatures = Vec::with_capacity(fixture.signatures.len());

        // Add second signature chunk first
        reversed_signatures
            .extend_from_slice(&fixture.signatures[SIGNATURE_BYTES_LEN..2 * SIGNATURE_BYTES_LEN]);

        // Add first signature chunk second
        reversed_signatures.extend_from_slice(&fixture.signatures[0..SIGNATURE_BYTES_LEN]);

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            &reversed_signatures,
        );

        // This should now pass with our new implementation
        assert!(result.is_ok());
    }

    #[test]
    fn test_verify_signatures_incorrect_data_size() {
        // Test case where signature data size is not divisible by SIGNATURE_BYTES_LEN
        let fixture = create_test_fixture();

        // Test with truncated signature data (64 bytes instead of 65)
        let truncated_signatures = &fixture.signatures[0..SIGNATURE_BYTES_LEN - 1];

        let result = SignatureValidator::verify_signatures(
            fixture.threshold,
            &fixture.signers,
            &fixture.digest,
            truncated_signatures,
        );

        assert_eq!(result.unwrap_err(), OneSigError::SignatureDataSizeMismatch.into());
    }
}
