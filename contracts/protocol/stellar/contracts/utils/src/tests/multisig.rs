use crate::{
    auth::Auth,
    errors::MultiSigError,
    multisig::{init_multisig, recover_signer, MultiSig, SignerSet, ThresholdSet},
    testing_utils::{assert_eq_event, assert_eq_events},
};
use soroban_sdk::{
    contract, contractimpl, testutils::AuthorizedFunction, vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

// Test contract implementing MultiSig + Auth (self-owning)
#[contract]
pub struct TestContract;

#[contractimpl]
impl TestContract {
    pub fn __constructor(env: &Env, signers: &Vec<BytesN<20>>, threshold: u32) {
        init_multisig(env, signers, threshold);
    }
}

/// Self-owning contract: the contract owns itself.
/// This allows multisig quorum approval to serve as the authorizer.
#[contractimpl]
impl Auth for TestContract {
    fn authorizer(env: &Env) -> Option<Address> {
        Some(env.current_contract_address())
    }
}

#[contractimpl(contracttrait)]
impl MultiSig for TestContract {}

fn signer(env: &Env, seed: u8) -> BytesN<20> {
    let mut bytes = [0u8; 20];
    bytes[0] = seed;
    BytesN::from_array(env, &bytes)
}

fn zero_signer(env: &Env) -> BytesN<20> {
    BytesN::from_array(env, &[0u8; 20])
}

fn assert_auth(env: &Env, contract: &Address, func: &str, expected_args: Vec<Val>) {
    let auths = env.auths();
    assert_eq!(auths.len(), 1);
    let (addr, invocation) = &auths[0];
    assert_eq!(addr, contract);
    assert!(invocation.sub_invocations.is_empty());
    match &invocation.function {
        AuthorizedFunction::Contract((id, symbol, args)) => {
            assert_eq!(id, contract);
            assert_eq!(symbol, &Symbol::new(env, func));
            assert_eq!(args, &expected_args);
        }
        _ => panic!("expected contract invocation auth"),
    }
}

// ============================================
// init: Initialization tests
// ============================================

#[test]
fn init_sets_signers_and_threshold() {
    let env = Env::default();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1.clone(), s2.clone()];

    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    assert_eq!(client.threshold(), 2);
    assert_eq!(client.total_signers(), 2);
    assert!(client.is_signer(&s1));
    assert!(client.is_signer(&s2));
}

#[test]
#[should_panic(expected = "Error(Contract, #1068)")] // ZeroThreshold
fn init_zero_threshold_fails() {
    let env = Env::default();
    let s1 = signer(&env, 1);
    let signers = vec![&env, s1];

    env.register(TestContract, (&signers, 0u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #1066)")] // TotalSignersLessThanThreshold
fn init_threshold_exceeds_signers_fails() {
    let env = Env::default();
    let s1 = signer(&env, 1);
    let signers = vec![&env, s1];

    env.register(TestContract, (&signers, 2u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #1060)")] // AlreadyInitialized
fn init_already_initialized_fails() {
    let env = Env::default();
    let s1 = signer(&env, 1);
    let signers = vec![&env, s1.clone()];

    let contract = env.register(TestContract, (&signers, 1u32));

    // Try to call init_multisig again - should fail with AlreadyInitialized
    env.as_contract(&contract, || {
        init_multisig(&env, &signers, 1);
    });
}

#[test]
fn init_emits_signer_and_threshold_events() {
    let env = Env::default();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1.clone(), s2.clone()];

    let contract = env.register(TestContract, (&signers, 2u32));

    assert_eq_events(
        &env,
        &contract,
        &[
            &SignerSet { signer: s1, active: true },
            &SignerSet { signer: s2, active: true },
            &ThresholdSet { threshold: 2 },
        ],
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #1062)")] // InvalidSigner
fn init_zero_signer_fails() {
    let env = Env::default();
    let signers = vec![&env, zero_signer(&env)];

    env.register(TestContract, (&signers, 1u32));
}

#[test]
#[should_panic(expected = "Error(Contract, #1064)")] // SignerAlreadyExists
fn init_duplicate_signers_fails() {
    let env = Env::default();
    let s1 = signer(&env, 1);
    let signers = vec![&env, s1.clone(), s1];

    env.register(TestContract, (&signers, 1u32));
}

// ============================================
// set_signer: Add/remove signer tests
// ============================================

#[test]
fn set_signer_add() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1.clone()];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    client.set_signer(&s2, &true);

    // Verify auth was required from the contract (self-owning)
    assert_auth(&env, &contract, "set_signer", (s2.clone(), true).into_val(&env));

    // Verify SignerSet event was emitted
    assert_eq_event(&env, &contract, SignerSet { signer: s2.clone(), active: true });

    assert_eq!(client.total_signers(), 2);
    assert!(client.is_signer(&s1));
    assert!(client.is_signer(&s2));
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn set_signer_requires_auth() {
    let env = Env::default();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    // No `mock_*auth*` provided -> contract.require_auth() must fail.
    client.set_signer(&s2, &true);
}

#[test]
fn set_signer_remove() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1.clone(), s2.clone()];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    client.set_signer(&s1, &false);

    // Verify auth was required from the contract (self-owning)
    assert_auth(&env, &contract, "set_signer", (s1.clone(), false).into_val(&env));

    // Verify SignerSet event was emitted
    assert_eq_event(&env, &contract, SignerSet { signer: s1.clone(), active: false });

    assert_eq!(client.total_signers(), 1);
    assert!(!client.is_signer(&s1));
    assert!(client.is_signer(&s2));
}

#[test]
fn set_signer_zero_address_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let res = client.try_set_signer(&zero_signer(&env), &true);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::InvalidSigner.into());
}

#[test]
fn set_signer_duplicate_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let signers = vec![&env, s1.clone()];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let res = client.try_set_signer(&s1, &true);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::SignerAlreadyExists.into());
}

#[test]
fn set_signer_remove_not_found_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let res = client.try_set_signer(&s2, &false);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::SignerNotFound.into());
}

#[test]
fn set_signer_remove_violates_threshold_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1.clone(), s2];

    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    let res = client.try_set_signer(&s1, &false);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::TotalSignersLessThanThreshold.into());
}

// ============================================
// set_threshold: Threshold tests
// ============================================

#[test]
fn set_threshold_success() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1, s2];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    client.set_threshold(&2);

    // Verify auth was required from the contract (self-owning)
    assert_auth(&env, &contract, "set_threshold", (2u32,).into_val(&env));

    // Verify ThresholdSet event was emitted
    assert_eq_event(&env, &contract, ThresholdSet { threshold: 2 });

    assert_eq!(client.threshold(), 2);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn set_threshold_requires_auth() {
    let env = Env::default();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let signers = vec![&env, s1, s2];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    // No `mock_*auth*` provided -> contract.require_auth() must fail.
    client.set_threshold(&2);
}

#[test]
fn set_threshold_zero_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let res = client.try_set_threshold(&0);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::ZeroThreshold.into());
}

#[test]
fn set_threshold_exceeds_signers_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let s1 = signer(&env, 1);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let res = client.try_set_threshold(&2);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::TotalSignersLessThanThreshold.into());
}

// ============================================
// get_signers: Returns all signers
// ============================================

#[test]
fn get_signers_returns_all() {
    let env = Env::default();

    let s1 = signer(&env, 1);
    let s2 = signer(&env, 2);
    let s3 = signer(&env, 3);
    let signers = vec![&env, s1.clone(), s2.clone(), s3.clone()];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let result = client.get_signers();
    assert_eq!(result.len(), 3);
    assert!(result.iter().any(|s| s == s1));
    assert!(result.iter().any(|s| s == s2));
    assert!(result.iter().any(|s| s == s3));
}

// ============================================
// verify: Signature verification tests
// ============================================

// Known test vectors for signature verification
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
fn verify_signatures_success() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    let signers = vec![&env, s1, s2];

    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    // Signatures must be sorted by signer address (s1 < s2)
    let signatures = vec![&env, test_sig1(&env), test_sig2(&env)];

    // Should not panic - uses configured threshold (2)
    client.verify_signatures(&digest, &signatures);
}

#[test]
fn verify_n_signatures_success() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    let signers = vec![&env, s1, s2];

    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    let signatures = vec![&env, test_sig1(&env), test_sig2(&env)];

    // Should not panic - custom threshold of 1 (only need 1 sig)
    client.verify_n_signatures(&digest, &signatures, &1);
}

#[test]
fn verify_n_signatures_zero_threshold_fails() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = BytesN::from_array(&env, &[0u8; 32]);
    let signatures: Vec<BytesN<65>> = vec![&env];

    let res = client.try_verify_n_signatures(&digest, &signatures, &0);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::ZeroThreshold.into());
}

#[test]
fn verify_n_signatures_insufficient_signatures_fails() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = BytesN::from_array(&env, &[0u8; 32]);
    let signatures: Vec<BytesN<65>> = vec![&env]; // Empty

    let res = client.try_verify_n_signatures(&digest, &signatures, &1);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::SignatureError.into());
}

#[test]
fn verify_n_signatures_signer_not_found_fails() {
    let env = Env::default();

    // Register with only signer2, but provide sig1 (from signer1)
    let s2 = test_signer2(&env);
    let signers = vec![&env, s2];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    let signatures = vec![&env, test_sig1(&env)]; // sig1 is from signer1, not registered

    let res = client.try_verify_n_signatures(&digest, &signatures, &1);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::SignerNotFound.into());
}

#[test]
fn verify_n_signatures_unsorted_signers_fails() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    let signers = vec![&env, s1, s2];

    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    // Wrong order: sig2 before sig1 (signer2 > signer1)
    let signatures = vec![&env, test_sig2(&env), test_sig1(&env)];

    let res = client.try_verify_n_signatures(&digest, &signatures, &2);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::UnsortedSigners.into());
}

#[test]
fn verify_n_signatures_duplicate_signers_fails() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    let signers = vec![&env, s1, s2];

    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    // Duplicate signer (sig1 twice) must fail the strict ordering check (not strictly increasing).
    let signatures = vec![&env, test_sig1(&env), test_sig1(&env)];

    let res = client.try_verify_n_signatures(&digest, &signatures, &2);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::UnsortedSigners.into());
}

#[test]
fn verify_n_signatures_threshold_one_still_requires_sorted_if_multiple_provided() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    let signers = vec![&env, s1, s2];

    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    // Even though threshold=1, passing multiple signatures still requires them to be strictly sorted.
    let signatures = vec![&env, test_sig2(&env), test_sig1(&env)];

    let res = client.try_verify_n_signatures(&digest, &signatures, &1);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::UnsortedSigners.into());
}

#[test]
fn verify_n_signatures_threshold_met_but_extra_invalid_signature_fails() {
    let env = Env::default();

    // Register only signer1 with threshold=1 (so sig1 alone would be sufficient).
    let s1 = test_signer1(&env);
    let signers = vec![&env, s1];

    let contract = env.register(TestContract, (&signers, 1u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    // Provide an extra signature from signer2 (not registered). Even though threshold is met,
    // verification checks *all provided signatures* and must fail.
    let signatures = vec![&env, test_sig1(&env), test_sig2(&env)];

    let res = client.try_verify_n_signatures(&digest, &signatures, &1);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::SignerNotFound.into());
}

#[test]
fn verify_signatures_enforces_configured_threshold() {
    let env = Env::default();

    let s1 = test_signer1(&env);
    let s2 = test_signer2(&env);
    let signers = vec![&env, s1, s2];

    // Configured threshold = 2
    let contract = env.register(TestContract, (&signers, 2u32));
    let client = TestContractClient::new(&env, &contract);

    let digest = test_digest(&env);
    // Only one signature -> must fail because `verify_signatures` uses configured threshold.
    let signatures = vec![&env, test_sig1(&env)];
    let res = client.try_verify_signatures(&digest, &signatures);
    assert_eq!(res.err().unwrap().ok().unwrap(), MultiSigError::SignatureError.into());
}

// ============================================
// recover: Signature recovery tests
// ============================================

#[test]
fn recover_signer_valid_signature() {
    let env = Env::default();

    // Known test vector: digest + signature -> expected signer
    // Using the same test data from onesig tests
    let digest_bytes = [
        0x7d, 0x84, 0xfd, 0x50, 0x8a, 0x27, 0xac, 0x81, 0xde, 0xe4, 0xbf, 0xa9, 0x7f, 0x29, 0xbe, 0xdb, 0x88, 0x5c,
        0x1b, 0xd7, 0xfc, 0x46, 0x50, 0xf4, 0x91, 0xe6, 0x4f, 0xbd, 0xaa, 0x05, 0xcd, 0xac,
    ];
    let digest = BytesN::from_array(&env, &digest_bytes);

    // Signature from signer 0x9b6ababd080456f900ed64e74d122ff9ca40daa1
    let sig_bytes = [
        0x31, 0x53, 0x7d, 0xcf, 0xe1, 0xec, 0x4d, 0x7e, 0x89, 0xf5, 0x97, 0x2c, 0xcd, 0x30, 0x65, 0xe3, 0x4e, 0x17,
        0x8e, 0x30, 0x2c, 0x1b, 0x9e, 0x8e, 0x17, 0x5d, 0x38, 0x43, 0xa2, 0x96, 0x4f, 0x28, // r
        0x63, 0xf2, 0xb6, 0x0c, 0x7e, 0xf7, 0x43, 0x63, 0xb6, 0x87, 0xf8, 0x22, 0xdb, 0x6c, 0x31, 0x3e, 0x87, 0x62,
        0xb3, 0x8d, 0x30, 0x97, 0xb6, 0xfe, 0xc9, 0xb7, 0xb7, 0x61, 0x65, 0x63, 0x0a, 0xaa, // s
        0x1b, // v = 27
    ];
    let signature = BytesN::from_array(&env, &sig_bytes);

    let expected_signer = BytesN::from_array(
        &env,
        &[
            0x9b, 0x6a, 0xba, 0xbd, 0x08, 0x04, 0x56, 0xf9, 0x00, 0xed, 0x64, 0xe7, 0x4d, 0x12, 0x2f, 0xf9, 0xca, 0x40,
            0xda, 0xa1,
        ],
    );

    let recovered = recover_signer(&env, &digest, &signature);
    assert_eq!(recovered, expected_signer);
}

#[test]
fn recover_signer_raw_v_path() {
    let env = Env::default();

    let digest_bytes = [
        0x7d, 0x84, 0xfd, 0x50, 0x8a, 0x27, 0xac, 0x81, 0xde, 0xe4, 0xbf, 0xa9, 0x7f, 0x29, 0xbe, 0xdb, 0x88, 0x5c,
        0x1b, 0xd7, 0xfc, 0x46, 0x50, 0xf4, 0x91, 0xe6, 0x4f, 0xbd, 0xaa, 0x05, 0xcd, 0xac,
    ];
    let digest = BytesN::from_array(&env, &digest_bytes);

    // Same signature but with v=0 instead of v=27
    let sig_bytes = [
        0x31, 0x53, 0x7d, 0xcf, 0xe1, 0xec, 0x4d, 0x7e, 0x89, 0xf5, 0x97, 0x2c, 0xcd, 0x30, 0x65, 0xe3, 0x4e, 0x17,
        0x8e, 0x30, 0x2c, 0x1b, 0x9e, 0x8e, 0x17, 0x5d, 0x38, 0x43, 0xa2, 0x96, 0x4f, 0x28, // r
        0x63, 0xf2, 0xb6, 0x0c, 0x7e, 0xf7, 0x43, 0x63, 0xb6, 0x87, 0xf8, 0x22, 0xdb, 0x6c, 0x31, 0x3e, 0x87, 0x62,
        0xb3, 0x8d, 0x30, 0x97, 0xb6, 0xfe, 0xc9, 0xb7, 0xb7, 0x61, 0x65, 0x63, 0x0a, 0xaa, // s
        0x00, // v = 0 (raw)
    ];
    let signature = BytesN::from_array(&env, &sig_bytes);

    let expected_signer = BytesN::from_array(
        &env,
        &[
            0x9b, 0x6a, 0xba, 0xbd, 0x08, 0x04, 0x56, 0xf9, 0x00, 0xed, 0x64, 0xe7, 0x4d, 0x12, 0x2f, 0xf9, 0xca, 0x40,
            0xda, 0xa1,
        ],
    );

    let recovered = recover_signer(&env, &digest, &signature);
    assert_eq!(recovered, expected_signer);
}

#[test]
#[should_panic(expected = "Error(Crypto, InvalidInput)")]
fn recover_signer_invalid_r_zero_fails() {
    let env = Env::default();

    let digest = BytesN::from_array(&env, &[0u8; 32]);

    // Signature with r=0 (invalid for secp256k1)
    let mut sig_bytes = [0u8; 65];
    // r = 0 (bytes 0-31 already 0)
    // s = some non-zero value (bytes 32-63)
    for i in 32..64 {
        sig_bytes[i] = 1;
    }
    sig_bytes[64] = 27; // v
    let signature = BytesN::from_array(&env, &sig_bytes);

    // Should panic - r=0 is invalid for secp256k1
    recover_signer(&env, &digest, &signature);
}

#[test]
#[should_panic(expected = "Error(Crypto, InvalidInput)")]
fn recover_signer_invalid_s_zero_fails() {
    let env = Env::default();

    let digest = BytesN::from_array(&env, &[0u8; 32]);

    // Signature with s=0 (invalid for secp256k1)
    let mut sig_bytes = [0u8; 65];
    // r = some non-zero value (bytes 0-31)
    for i in 0..32 {
        sig_bytes[i] = 1;
    }
    // s = 0 (bytes 32-63 already 0)
    sig_bytes[64] = 27; // v
    let signature = BytesN::from_array(&env, &sig_bytes);

    // Should panic - s=0 is invalid for secp256k1
    recover_signer(&env, &digest, &signature);
}

#[test]
#[should_panic(expected = "Error(Crypto, InvalidInput)")]
fn recover_signer_invalid_v_fails() {
    let env = Env::default();

    let digest = BytesN::from_array(&env, &[0u8; 32]);

    // Signature with invalid v value (v=29 normalizes to 2, which is invalid)
    let mut sig_bytes = [1u8; 65];
    sig_bytes[64] = 29; // v=29 -> normalized to 2 (invalid, must be 0 or 1)
    let signature = BytesN::from_array(&env, &sig_bytes);

    // Should panic - recovery_id must be 0 or 1
    recover_signer(&env, &digest, &signature);
}
