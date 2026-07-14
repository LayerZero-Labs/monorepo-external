// Runtime tests: `#[multisig]` ensures the contract implements `utils::multisig::MultiSig`.
//
// We exercise:
// - `set_signer` / `set_threshold` behavior (via direct trait calls inside `as_contract`)
// - `verify_signatures` / `verify_n_signatures` error paths (via exported contract entrypoints)

use super::{TestContract, TestContractClient};
use soroban_sdk::{
    xdr::{ScErrorCode, ScErrorType},
    BytesN, Env, Error, Vec,
};
use utils::{
    multisig::{SignerSet, ThresholdSet},
    testing_utils::assert_eq_event,
};

// Test vectors copied from `utils/src/tests/multisig.rs` so we can exercise success paths
// through the macro-generated contract entrypoints.
fn test_digest(env: &Env) -> BytesN<32> {
    BytesN::from_array(
        env,
        &[
            0x7d, 0x84, 0xfd, 0x50, 0x8a, 0x27, 0xac, 0x81, 0xde, 0xe4, 0xbf, 0xa9, 0x7f, 0x29, 0xbe, 0xdb, 0x88, 0x5c,
            0x1b, 0xd7, 0xfc, 0x46, 0x50, 0xf4, 0x91, 0xe6, 0x4f, 0xbd, 0xaa, 0x05, 0xcd, 0xac,
        ],
    )
}

// Signer 1: 0x9b6ababd080456f900ed64e74d122ff9ca40daa1
fn test_signer1(env: &Env) -> BytesN<20> {
    BytesN::from_array(
        env,
        &[
            0x9b, 0x6a, 0xba, 0xbd, 0x08, 0x04, 0x56, 0xf9, 0x00, 0xed, 0x64, 0xe7, 0x4d, 0x12, 0x2f, 0xf9, 0xca, 0x40,
            0xda, 0xa1,
        ],
    )
}

// Signer 2: 0xd6869dacf9c6ce629cf042864737690641d0e2d7
fn test_signer2(env: &Env) -> BytesN<20> {
    BytesN::from_array(
        env,
        &[
            0xd6, 0x86, 0x9d, 0xac, 0xf9, 0xc6, 0xce, 0x62, 0x9c, 0xf0, 0x42, 0x86, 0x47, 0x37, 0x69, 0x06, 0x41, 0xd0,
            0xe2, 0xd7,
        ],
    )
}

// Signature from signer1 for test_digest
fn test_sig1(env: &Env) -> BytesN<65> {
    BytesN::from_array(
        env,
        &[
            0x31, 0x53, 0x7d, 0xcf, 0xe1, 0xec, 0x4d, 0x7e, 0x89, 0xf5, 0x97, 0x2c, 0xcd, 0x30, 0x65, 0xe3, 0x4e, 0x17,
            0x8e, 0x30, 0x2c, 0x1b, 0x9e, 0x8e, 0x17, 0x5d, 0x38, 0x43, 0xa2, 0x96, 0x4f, 0x28, // r
            0x63, 0xf2, 0xb6, 0x0c, 0x7e, 0xf7, 0x43, 0x63, 0xb6, 0x87, 0xf8, 0x22, 0xdb, 0x6c, 0x31, 0x3e, 0x87, 0x62,
            0xb3, 0x8d, 0x30, 0x97, 0xb6, 0xfe, 0xc9, 0xb7, 0xb7, 0x61, 0x65, 0x63, 0x0a, 0xaa, // s
            0x1b, // v = 27
        ],
    )
}

// Signature from signer2 for test_digest
fn test_sig2(env: &Env) -> BytesN<65> {
    BytesN::from_array(
        env,
        &[
            0x42, 0x67, 0x4f, 0xc6, 0x30, 0xe3, 0x2f, 0x90, 0x00, 0xbc, 0x95, 0x27, 0x1e, 0xc5, 0x42, 0x83, 0xc8, 0xad,
            0x35, 0x00, 0x16, 0xbb, 0x66, 0xa1, 0x84, 0x64, 0x95, 0x89, 0x63, 0xa5, 0x1f, 0x03, // r
            0x14, 0x6e, 0x8b, 0x3f, 0xbb, 0x3a, 0x5b, 0xd0, 0xb8, 0x9d, 0x3b, 0x6c, 0x1e, 0x01, 0xdd, 0x61, 0x4e, 0x86,
            0xba, 0xe0, 0x13, 0x51, 0xdc, 0x3d, 0x1f, 0xfe, 0x35, 0x22, 0xc8, 0x3e, 0xd4, 0x50, // s
            0x1c, // v = 28
        ],
    )
}

#[test]
fn set_signer_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);
    let signer = BytesN::<20>::from_array(&env, &[1u8; 20]);

    // No auth provided -> should fail.
    let res = client.try_set_signer(&signer, &true);
    assert_eq!(res.unwrap_err().unwrap(), Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction));
}

#[test]
fn set_threshold_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // No auth provided -> should fail (auth happens before any threshold validation).
    let res = client.try_set_threshold(&1);
    assert_eq!(res.unwrap_err().unwrap(), Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction));
}

#[test]
fn set_signer_and_threshold_work_with_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let signer = BytesN::<20>::from_array(&env, &[1u8; 20]);

    // These must be exported contract entrypoints via the macro-generated contractimpl(contracttrait).
    client.set_signer(&signer, &true);
    assert_eq_event(&env, &contract_id, SignerSet { signer: signer.clone(), active: true });

    client.set_threshold(&1);
    assert_eq_event(&env, &contract_id, ThresholdSet { threshold: 1 });

    assert!(client.is_signer(&signer));
    assert_eq!(client.total_signers(), 1);
    assert_eq!(client.threshold(), 1);

    // Cannot set threshold higher than total signers.
    let res = client.try_set_threshold(&2);
    assert_eq!(res.err().unwrap().ok().unwrap(), utils::errors::MultiSigError::TotalSignersLessThanThreshold.into());
    // Threshold should remain unchanged.
    assert_eq!(client.threshold(), 1);
}

#[test]
fn set_signer_remove_path_works() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let signer = BytesN::<20>::from_array(&env, &[1u8; 20]);
    client.set_signer(&signer, &true);
    assert_eq_event(&env, &contract_id, SignerSet { signer: signer.clone(), active: true });
    assert!(client.is_signer(&signer));
    assert_eq!(client.total_signers(), 1);

    // active=false branch should remove the signer.
    client.set_signer(&signer, &false);
    assert_eq_event(&env, &contract_id, SignerSet { signer: signer.clone(), active: false });
    assert!(!client.is_signer(&signer));
    assert_eq!(client.total_signers(), 0);
}

#[test]
fn verify_signatures_rejects_zero_threshold_by_default() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Default threshold is 0 (from storage default), so verify should error with ZeroThreshold.
    let digest = BytesN::<32>::from_array(&env, &[9u8; 32]);
    let sigs = Vec::<BytesN<65>>::new(&env);

    let result = client.try_verify_signatures(&digest, &sigs);
    assert_eq!(result.err().unwrap().ok().unwrap(), utils::errors::MultiSigError::ZeroThreshold.into());
}

#[test]
fn verify_n_signatures_rejects_insufficient_signatures() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let digest = BytesN::<32>::from_array(&env, &[8u8; 32]);
    let sigs = Vec::<BytesN<65>>::new(&env);

    // threshold=1 but 0 signatures => SignatureError
    let result = client.try_verify_n_signatures(&digest, &sigs, &1);
    assert_eq!(result.err().unwrap().ok().unwrap(), utils::errors::MultiSigError::SignatureError.into());

    // threshold=1 with a valid signature but no registered signers => SignerNotFound
    let digest = test_digest(&env);
    let sigs = Vec::from_array(&env, [test_sig1(&env)]);
    let result = client.try_verify_n_signatures(&digest, &sigs, &1);
    assert_eq!(result.err().unwrap().ok().unwrap(), utils::errors::MultiSigError::SignerNotFound.into());
}

#[test]
fn verify_signatures_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Configure signers + threshold=2 using macro-exported entrypoints.
    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    client.set_signer(&s1, &true);
    client.set_signer(&s2, &true);
    client.set_threshold(&2);

    let digest = test_digest(&env);
    // Must be sorted by signer address (s1 < s2).
    let sigs = Vec::from_array(&env, [test_sig1(&env), test_sig2(&env)]);
    client.verify_signatures(&digest, &sigs);

    // Unsorted signatures should be rejected.
    let unsorted = Vec::from_array(&env, [test_sig2(&env), test_sig1(&env)]);
    let result = client.try_verify_signatures(&digest, &unsorted);
    assert_eq!(result.err().unwrap().ok().unwrap(), utils::errors::MultiSigError::UnsortedSigners.into());
}

#[test]
fn verify_n_signatures_success() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // Configure signers (threshold stored is irrelevant for verify_n_signatures).
    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    client.set_signer(&s1, &true);
    client.set_signer(&s2, &true);
    client.set_threshold(&2);

    let digest = test_digest(&env);
    let sigs = Vec::from_array(&env, [test_sig1(&env), test_sig2(&env)]);
    client.verify_n_signatures(&digest, &sigs, &1);
}

#[test]
fn set_signer_rejects_zero_address() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let zero = BytesN::<20>::from_array(&env, &[0u8; 20]);
    let res = client.try_set_signer(&zero, &true);
    assert_eq!(res.err().unwrap().ok().unwrap(), utils::errors::MultiSigError::InvalidSigner.into());
}
