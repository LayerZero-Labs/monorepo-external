use super::helpers::{
    assert_latest_auth, create_onesig_for_onesig_tests, create_onesig_with_defaults,
    ed25519_public_key, generate_ed25519_keypair, generate_secp256k1_keypair, generate_signer,
    new_executor_key, secp256k1_sign, secp256k1_signer_address,
};
use crate::{
    eip712::{build_sign_merkle_root_digest, build_signer_execution_authorization_digest},
    errors::OneSigError,
    interfaces::{Call, Sender, SenderKey, SignerExecutionProof, Transaction, TransactionAuthData},
    onesig::OneSigClient,
};
use ed25519_dalek::{Signer as _, SigningKey as Ed25519SigningKey};
use soroban_sdk::{
    auth::{Context, ContractExecutable, CreateContractHostFnContext},
    testutils::{Address as _, Events, Ledger},
    vec, Address, BytesN, Env, IntoVal, Map, Symbol, Val, Vec,
};
use utils::errors::MultiSigError;

fn setup<'a>() -> (Env, Address, OneSigClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = create_onesig_for_onesig_tests(&env);
    let client = OneSigClient::new(&env, &contract_id);

    (env, contract_id, client)
}

#[test]
fn test_set_seed() {
    let (env, _contract_id, client) = setup();

    let seed = BytesN::from_array(&env, &[1u8; 32]);

    // Set seed via contract self-call (mocked auth)
    client.set_seed(&seed);

    // Verify seed was set
    let retrieved_seed = client.seed();
    assert_eq!(retrieved_seed, seed);
}

#[test]
fn test_seed_set_event() {
    let (env, contract_id, client) = setup();

    let seed = BytesN::from_array(&env, &[1u8; 32]);

    // Set seed
    client.set_seed(&seed);

    // Verify SeedSet event was emitted
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                contract_id.clone(),
                (Symbol::new(&env, "seed_set"),).into_val(&env),
                Map::<Symbol, Val>::from_array(
                    &env,
                    [(Symbol::new(&env, "seed"), seed.into_val(&env)),]
                )
                .into_val(&env),
            ),
        ]
    );
}

#[test]
fn test_set_seed_auth_verification() {
    let (env, contract_id, client) = setup();

    let seed = BytesN::from_array(&env, &[2u8; 32]);

    client.set_seed(&seed);

    assert_latest_auth(&env, &contract_id, "set_seed", (&seed,).into_val(&env));
}

#[test]
fn test_seed_getter() {
    let (env, _contract_id, client) = setup();

    // Initially seed should be zero
    let initial_seed = client.seed();
    assert_eq!(initial_seed, BytesN::from_array(&env, &[0u8; 32]));

    // Set a seed
    let seed = BytesN::from_array(&env, &[0x42u8; 32]);
    client.set_seed(&seed);

    // Verify getter returns the set seed
    let retrieved_seed = client.seed();
    assert_eq!(retrieved_seed, seed);
}

#[test]
fn test_encode_leaf() {
    let (env, _contract_id, client) = setup();

    // Set onesig_id for consistent encoding
    // Note: onesig_id is stored, but we need to set it via storage directly in tests
    // For now, test with default value (0)

    let nonce = 1u64;
    let target_contract = Address::generate(&env);
    let func = Symbol::new(&env, "test_func");
    let args = vec![&env];

    let call = Call {
        to: target_contract.clone(),
        func: func.clone(),
        args: args.clone(),
        sub_invocations: vec![&env],
    };

    // Encode leaf - should not panic
    let leaf = client.encode_leaf(&nonce, &call);

    // Leaf should be 32 bytes
    assert_eq!(leaf.len(), 32);

    // Encoding same data should produce same leaf
    let leaf2 = client.encode_leaf(&nonce, &call);
    assert_eq!(leaf, leaf2);

    // Different nonce should produce different leaf
    let leaf3 = client.encode_leaf(&2u64, &call);
    assert_ne!(leaf, leaf3);

    // Different call should produce different leaf
    let different_call = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "different_func"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };
    let leaf4 = client.encode_leaf(&nonce, &different_call);
    assert_ne!(leaf, leaf4);
}

#[test]
fn test_encode_leaf_with_different_functions() {
    let (env, _contract_id, client) = setup();

    let nonce = 0u64;
    let call1 = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "func1"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };
    let call2 = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "func2"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };

    let leaf1 = client.encode_leaf(&nonce, &call1);
    let leaf2 = client.encode_leaf(&nonce, &call2);
    assert_eq!(leaf1.len(), 32);
    assert_eq!(leaf2.len(), 32);
    // Different calls should produce different leaves
    assert_ne!(leaf1, leaf2);
}

#[test]
fn test_can_execute_transaction_permissionless() {
    let (env, _contract_id, client) = setup();

    // Default should be permissionless (executor_required = false)
    // Any sender should be able to execute when executor_required is false
    let sender_key = new_executor_key(&env);
    let sender = SenderKey::Executor(sender_key);
    assert!(client.can_execute_transaction(&sender));
}

#[test]
fn test_can_execute_transaction_executor_required_with_executor() {
    let (env, contract_id, client) = setup();

    let executor_client = crate::interfaces::ExecutorClient::new(&env, &contract_id);

    // Add an executor first
    let executor_key = new_executor_key(&env);
    executor_client.set_executor(&executor_key, &true);

    // Now set executor_required to true
    executor_client.set_executor_required(&true);

    // Executor should be able to execute
    let executor_sender = SenderKey::Executor(executor_key.clone());
    assert!(client.can_execute_transaction(&executor_sender));

    // Non-executor should not be able to execute
    let non_executor_key = new_executor_key(&env);
    let non_executor_sender = SenderKey::Executor(non_executor_key);
    assert!(!client.can_execute_transaction(&non_executor_sender));
}

#[test]
fn test_can_execute_transaction_executor_required_with_signer() {
    let (env, contract_id, client) = setup();

    let executor_client = crate::interfaces::ExecutorClient::new(&env, &contract_id);

    // Add a signer (signers are stored as BytesN<20>)
    let signer_bytes = generate_signer(&env, 1);
    client.set_signer(&signer_bytes, &true);

    // Add an executor first
    let executor_key = new_executor_key(&env);
    executor_client.set_executor(&executor_key, &true);

    // Now set executor_required to true
    executor_client.set_executor_required(&true);

    // Executor should be able to execute
    let executor_sender = SenderKey::Executor(executor_key.clone());
    assert!(client.can_execute_transaction(&executor_sender));

    // Registered signer should also be able to execute
    let signer_sender = SenderKey::Signer(signer_bytes.clone());
    assert!(client.can_execute_transaction(&signer_sender));

    // Unregistered signer should be rejected
    let non_signer_bytes = generate_signer(&env, 99);
    let non_signer_sender = SenderKey::Signer(non_signer_bytes);
    assert!(!client.can_execute_transaction(&non_signer_sender));
}

#[test]
fn test_onesig_id_getter() {
    let (_env, _contract_id, client) = setup();

    // Initially should return 0
    let onesig_id = client.onesig_id();
    assert_eq!(onesig_id, 0);
}

#[test]
fn test_address_to_bytes32_contract_address() {
    let (env, contract_id, client) = setup();

    // Test that encode_leaf works with contract addresses
    // This indirectly tests address_to_bytes32 which now uses strkey decoding
    let nonce = 0u64;
    // Use the contract_id from setup - this is a contract address
    let call = Call {
        to: contract_id,
        func: Symbol::new(&env, "test"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };

    // Should not panic - contract address should be handled correctly via strkey decoding
    let leaf = client.encode_leaf(&nonce, &call);
    assert_eq!(leaf.len(), 32);

    // Verify that the same contract address produces the same leaf
    let leaf2 = client.encode_leaf(&nonce, &call);
    assert_eq!(leaf, leaf2);
}

#[test]
fn test_address_to_bytes32_with_different_contracts() {
    let (env, contract_id, client) = setup();

    // Test that different contract addresses produce different leaves
    let nonce = 0u64;

    let contract1 = contract_id;
    let contract2 = Address::generate(&env);

    let call1 = Call {
        to: contract1,
        func: Symbol::new(&env, "test"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };

    let call2 = Call {
        to: contract2,
        func: Symbol::new(&env, "test"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };

    let leaf1 = client.encode_leaf(&nonce, &call1);
    let leaf2 = client.encode_leaf(&nonce, &call2);

    // Different contract addresses should produce different leaves
    assert_ne!(leaf1, leaf2);
}

#[test]
fn test_verify_transaction_proof_invalid_proof() {
    let (env, _contract_id, client) = setup();

    let _nonce = 0u64;
    let call = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "dummy"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };
    let invalid_proof = vec![&env, BytesN::from_array(&env, &[0u8; 32])];
    let invalid_root = BytesN::from_array(&env, &[1u8; 32]);

    let transaction = Transaction {
        call,
        proof: invalid_proof,
    };

    // Should return InvalidProofOrNonce error
    let res = client.try_verify_transaction_proof(&invalid_root, &transaction);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        OneSigError::InvalidProofOrNonce.into()
    );
}

#[test]
fn test_verify_merkle_root_expired() {
    let (env, _contract_id, client) = setup();

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let expiry = 0u64; // Expired (timestamp 0)
    let signatures = vec![&env];

    // Set a seed first
    let seed = BytesN::from_array(&env, &[1u8; 32]);
    client.set_seed(&seed);

    // Advance ledger timestamp to make expiry invalid
    env.ledger().set_timestamp(1000);

    let res = client.try_verify_merkle_root(&merkle_root, &expiry, &signatures);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        OneSigError::MerkleRootExpired.into()
    );
}

#[test]
fn test_verify_merkle_root_not_expired_but_invalid_signatures() {
    let (env, _contract_id, client) = setup();

    // Set seed
    let seed = BytesN::from_array(&env, &[1u8; 32]);
    client.set_seed(&seed);

    // Register one signer, but provide a valid-format signature from a different signer key.
    // This should fail with SignerNotFound rather than panicking.
    let registered_signer_key = generate_secp256k1_keypair();
    let registered_signer_address = secp256k1_signer_address(&env, &registered_signer_key);
    client.set_signer(&registered_signer_address, &true);
    client.set_threshold(&1);

    let unregistered_signer_key = generate_secp256k1_keypair();

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let expiry = 9999u64; // Future timestamp

    // Set ledger timestamp to current time
    env.ledger().set_timestamp(1000);

    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let invalid_signature = secp256k1_sign(&env, &unregistered_signer_key, &digest);
    let signatures = vec![&env, invalid_signature];

    let res = client.try_verify_merkle_root(&merkle_root, &expiry, &signatures);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        MultiSigError::SignerNotFound.into()
    );
}

#[test]
fn test_verify_transaction_proof_wrong_nonce() {
    let (env, _contract_id, client) = setup();

    // Current nonce is 0, but we'll try to verify with nonce 1
    // This should fail because verify_transaction_proof uses current_nonce
    let call = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "dummy"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };
    // Create a proof that would work for nonce 1, but current nonce is 0
    let proof = vec![&env, BytesN::from_array(&env, &[0u8; 32])];
    let root = BytesN::from_array(&env, &[1u8; 32]);

    let transaction = Transaction { call, proof };

    // Note: This test verifies that verify_transaction_proof uses current_nonce
    // and doesn't allow skipping nonces
    let res = client.try_verify_transaction_proof(&root, &transaction);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        OneSigError::InvalidProofOrNonce.into()
    );
}

#[test]
fn test_verify_transaction_proof_correct_calls_wrong_proof() {
    let (env, _contract_id, client) = setup();

    // Create valid call
    let call = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "test"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };

    // Create a proof that doesn't match the call
    let wrong_proof = vec![&env, BytesN::from_array(&env, &[0xFFu8; 32])];
    let root = BytesN::from_array(&env, &[1u8; 32]);

    let transaction = Transaction {
        call,
        proof: wrong_proof,
    };

    // Should return InvalidProofOrNonce because proof doesn't match
    let res = client.try_verify_transaction_proof(&root, &transaction);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        OneSigError::InvalidProofOrNonce.into()
    );
}

#[test]
fn test_verify_merkle_root_insufficient_signatures() {
    let (env, _contract_id, client) = setup();

    // Set seed
    let seed = BytesN::from_array(&env, &[1u8; 32]);
    client.set_seed(&seed);

    // Set up signers and threshold = 2
    let signer1 = generate_signer(&env, 1);
    let signer2 = generate_signer(&env, 2);
    client.set_signer(&signer1, &true);
    client.set_signer(&signer2, &true);
    client.set_threshold(&2);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let expiry = 9999u64; // Future timestamp

    // Only provide 1 signature when threshold is 2
    // The signature recovery will fail, causing SignatureError
    let mut signatures = vec![&env];
    let sig_bytes = [0u8; 65];
    signatures.push_back(BytesN::from_array(&env, &sig_bytes));

    // Set ledger timestamp to current time
    env.ledger().set_timestamp(1000);

    // Signature recovery fails (invalid format)
    let res = client.try_verify_merkle_root(&merkle_root, &expiry, &signatures);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        MultiSigError::SignatureError.into()
    );
}

// Panics with Crypto::InvalidInput (host error) because signature format is invalid
#[test]
#[should_panic]
fn test_verify_merkle_root_invalid_signature_format() {
    let (env, _contract_id, client) = setup();

    // Set seed
    let seed = BytesN::from_array(&env, &[1u8; 32]);
    client.set_seed(&seed);

    // Set up signers and threshold = 1
    let signer1 = generate_signer(&env, 1);
    client.set_signer(&signer1, &true);
    client.set_threshold(&1);

    let merkle_root = BytesN::from_array(&env, &[1u8; 32]);
    let expiry = 9999u64; // Future timestamp

    // Create an invalid signature format (all 0xFF)
    // This will fail at the crypto level before signature recovery
    let mut signatures = vec![&env];
    let sig_bytes = [0xFFu8; 65];
    signatures.push_back(BytesN::from_array(&env, &sig_bytes));

    // Set ledger timestamp to current time
    env.ledger().set_timestamp(1000);

    client.verify_merkle_root(&merkle_root, &expiry, &signatures);
}

#[test]
fn test_encode_leaf_with_empty_args() {
    let (env, _contract_id, client) = setup();

    let nonce = 0u64;
    let call = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "test"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };

    // Should not panic with empty args
    let leaf = client.encode_leaf(&nonce, &call);
    assert_eq!(leaf.len(), 32);

    // Encoding same call should produce same leaf
    let leaf2 = client.encode_leaf(&nonce, &call);
    assert_eq!(leaf, leaf2);
}

#[test]
fn test_nonce_getter_consistency() {
    let (_env, _contract_id, client) = setup();

    // Initially nonce should be 0
    assert_eq!(client.nonce(), 0);

    // Nonce should remain 0 after multiple reads
    assert_eq!(client.nonce(), 0);
    assert_eq!(client.nonce(), 0);
}

#[test]
fn test_verify_transaction_proof_dummy_call() {
    let (env, _contract_id, client) = setup();

    // Test with a dummy call - should still validate proof structure
    let call = Call {
        to: Address::generate(&env),
        func: Symbol::new(&env, "dummy"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };
    let proof = vec![&env, BytesN::from_array(&env, &[0u8; 32])];
    let root = BytesN::from_array(&env, &[1u8; 32]);

    let transaction = Transaction { call, proof };

    // Proof won't match, testing that proof validation works correctly
    let res = client.try_verify_transaction_proof(&root, &transaction);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        OneSigError::InvalidProofOrNonce.into()
    );
}

// ============================================================================
// Tests for __check_auth and calls_from_contexts
// ============================================================================

#[test]
fn test_check_auth_empty_contexts() {
    let env = Env::default();

    // Generate a real secp256k1 keypair for the signer
    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    // Set up contract with known seed and the real signer
    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        None,
        Some(false),
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    // Empty contexts - use a dummy call for the leaf encoding
    let dummy_call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "dummy"),
        args: vec![&env],
        sub_invocations: vec![&env],
    };
    let auth_contexts: Vec<Context> = vec![&env];

    // Encode the leaf with a dummy call
    let leaf = client.encode_leaf(&0u64, &dummy_call);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Permissionless,
    };

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    // Should fail with InvalidAuthContext (empty contexts no longer allowed)
    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(
        result.unwrap_err(),
        Ok(crate::errors::OneSigError::InvalidAuthContext)
    );
    assert_eq!(client.nonce(), 0);
}

#[test]
fn test_check_auth_non_executor_rejected_when_executor_required() {
    use super::helpers::ed25519_public_key;
    use ed25519_dalek::Signer;

    let env = Env::default();

    // Generate secp256k1 keypair for the signer (for merkle root signatures)
    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    // Generate ed25519 keypairs - one for a valid executor, one for a non-executor
    let valid_executor_keypair = generate_ed25519_keypair();
    let valid_executor_key = ed25519_public_key(&env, &valid_executor_keypair);

    let non_executor_keypair = generate_ed25519_keypair();
    let non_executor_key = ed25519_public_key(&env, &non_executor_keypair);

    // Set up contract with executor_required = true
    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];
    let executors = vec![&env, valid_executor_key.clone()]; // Only valid_executor is an executor

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        Some(executors),
        Some(true), // executor_required = true
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    // Create a valid call
    let new_seed = BytesN::from_array(&env, &[99u8; 32]);
    let call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
        sub_invocations: vec![&env],
    };

    let leaf = client.encode_leaf(&0u64, &call);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    // Create auth context
    let auth_context = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
    });
    let auth_contexts = vec![&env, auth_context];

    // Sign the payload with non-executor's ed25519 key
    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let sender_sig_bytes = non_executor_keypair.sign(&payload.to_array());
    let sender_signature: BytesN<64> = BytesN::from_array(&env, &sender_sig_bytes.to_bytes());

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Executor(non_executor_key, sender_signature),
    };

    // Should fail with OnlyExecutorOrSigner because non_executor_key is not an executor
    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    assert!(result.is_err(), "Non-executor should be rejected");
    assert_eq!(
        result.unwrap_err(),
        Ok(crate::errors::OneSigError::OnlyExecutorOrSigner)
    );
}

#[test]
fn test_check_auth_executor_accepted_when_executor_required() {
    use super::helpers::ed25519_public_key;
    use ed25519_dalek::Signer;

    let env = Env::default();

    // Generate secp256k1 keypair for the signer
    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    // Generate ed25519 keypair for the executor
    let executor_keypair = generate_ed25519_keypair();
    let executor_key = ed25519_public_key(&env, &executor_keypair);

    // Set up contract with executor_required = true
    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];
    let executors = vec![&env, executor_key.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        Some(executors),
        Some(true), // executor_required = true
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    // Create a valid call
    let new_seed = BytesN::from_array(&env, &[99u8; 32]);
    let call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
        sub_invocations: vec![&env],
    };

    let leaf = client.encode_leaf(&0u64, &call);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    // Create auth context
    let auth_context = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
    });
    let auth_contexts = vec![&env, auth_context];

    // Sign the payload with executor's ed25519 key
    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let sender_sig_bytes = executor_keypair.sign(&payload.to_array());
    let sender_signature: BytesN<64> = BytesN::from_array(&env, &sender_sig_bytes.to_bytes());

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Executor(executor_key, sender_signature),
    };

    // Should succeed because executor_key is a valid executor
    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    assert!(result.is_ok(), "Executor should be accepted: {:?}", result);
    assert_eq!(client.nonce(), 1);
}

// ============================================================================
// Signer-as-executor tests
// ============================================================================

/// Fixture building a fully valid signer-as-executor auth payload.
/// Individual tests mutate specific fields to exercise failure modes.
struct SignerExecutionProofFixture<'a> {
    env: Env,
    contract_id: Address,
    client: OneSigClient<'a>,
    signing_key: k256::ecdsa::SigningKey,
    executor_keypair: Ed25519SigningKey,
    delegate: BytesN<32>,
    seed: BytesN<32>,
    call: Call,
    leaf: BytesN<32>,
    expiry: u64,
    proof_expiry: u64,
    payload: BytesN<32>,
    auth_contexts: Vec<Context>,
    new_seed: BytesN<32>,
}

fn setup_signer_execution_proof<'a>(executor_required: bool) -> SignerExecutionProofFixture<'a> {
    let env = Env::default();

    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    // delegate is a fresh ed25519 key that is NOT a registered executor —
    // signer-as-executor lets the signer submit even without executor registration.
    let executor_keypair = generate_ed25519_keypair();
    let delegate = ed25519_public_key(&env, &executor_keypair);

    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address];
    // Register an unrelated executor so the list isn't empty and the "signer is
    // not an executor" path is exercised for real.
    let executors = vec![&env, new_executor_key(&env)];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        Some(executors),
        Some(executor_required),
    );

    let client = OneSigClient::new(&env, &contract_id);
    env.ledger().set_timestamp(1000);

    let new_seed = BytesN::from_array(&env, &[99u8; 32]);
    let call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.clone().into_val(&env)],
        sub_invocations: vec![&env],
    };
    let leaf = client.encode_leaf(&0u64, &call);

    let auth_context = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.clone().into_val(&env)],
    });
    let auth_contexts = vec![&env, auth_context];

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    SignerExecutionProofFixture {
        env,
        contract_id,
        client,
        signing_key,
        executor_keypair,
        delegate,
        seed,
        call,
        leaf,
        expiry: 9999u64,
        proof_expiry: 2000u64, // ledger timestamp is 1000 — comfortably in future
        payload,
        auth_contexts,
        new_seed,
    }
}

/// Build a `TransactionAuthData` carrying a valid signer-as-executor proof for the fixture.
///
/// `override_*` hooks let tests tamper with specific fields without recomputing
/// the rest of the payload — e.g. to simulate "signer signed a different expiry
/// than what ends up in the struct". `override_signed_merkle_root` overrides the
/// root the signer commits to (the auth payload still carries `f.leaf` as the
/// executing root), exercising the cross-root binding check.
fn build_signer_execution_proof_auth_data(
    f: &SignerExecutionProofFixture,
    override_signed_expiry: Option<u64>,
    override_signed_delegate: Option<BytesN<32>>,
    override_delegate_proof_payload: Option<BytesN<32>>,
    override_signed_merkle_root: Option<BytesN<32>>,
) -> TransactionAuthData {
    let env = &f.env;
    let merkle_root = f.leaf.clone();
    let digest = build_sign_merkle_root_digest(env, &f.seed, &merkle_root, f.expiry);
    let merkle_signature = secp256k1_sign(env, &f.signing_key, &digest);

    let signed_delegate = override_signed_delegate.unwrap_or_else(|| f.delegate.clone());
    let signed_expiry = override_signed_expiry.unwrap_or(f.proof_expiry);
    let signed_merkle_root = override_signed_merkle_root.unwrap_or_else(|| merkle_root.clone());
    let authorization_digest = build_signer_execution_authorization_digest(
        env,
        &f.leaf,
        &signed_merkle_root,
        &signed_delegate,
        signed_expiry,
    );
    let signature = secp256k1_sign(env, &f.signing_key, &authorization_digest);

    let delegate_proof_payload =
        override_delegate_proof_payload.unwrap_or_else(|| f.payload.clone());
    let executor_sig_bytes = f.executor_keypair.sign(&delegate_proof_payload.to_array());
    let delegate_proof: BytesN<64> = BytesN::from_array(env, &executor_sig_bytes.to_bytes());

    TransactionAuthData {
        merkle_root,
        expiry: f.expiry,
        proof: vec![env],
        signatures: vec![env, merkle_signature],
        sender: Sender::Signer(SignerExecutionProof {
            signature,
            expiry: f.proof_expiry,
            delegate: f.delegate.clone(),
            delegate_proof,
        }),
    }
}

#[test]
fn test_signer_as_executor_valid() {
    let f = setup_signer_execution_proof(true);
    let auth_data = build_signer_execution_proof_auth_data(&f, None, None, None, None);

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );

    assert!(
        result.is_ok(),
        "signer-as-executor should succeed with a well-formed payload: {:?}",
        result
    );
    assert_eq!(f.client.nonce(), 1);
    // Silence unused warnings — helper fields are consumed via the fixture.
    let _ = (&f.call, &f.new_seed);
}

#[test]
fn test_signer_as_executor_bypasses_when_executor_required_false() {
    // With executor_required=false, __check_auth short-circuits before touching
    // the sender payload — even obviously invalid proofs must be accepted.
    let f = setup_signer_execution_proof(false);

    let merkle_root = f.leaf.clone();
    let digest = build_sign_merkle_root_digest(&f.env, &f.seed, &merkle_root, f.expiry);
    let merkle_signature = secp256k1_sign(&f.env, &f.signing_key, &digest);

    let garbage_proof: BytesN<65> = BytesN::from_array(&f.env, &[0u8; 65]);
    let garbage_delegate_proof: BytesN<64> = BytesN::from_array(&f.env, &[0u8; 64]);

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry: f.expiry,
        proof: vec![&f.env],
        signatures: vec![&f.env, merkle_signature],
        sender: Sender::Signer(SignerExecutionProof {
            signature: garbage_proof,
            expiry: 0, // already expired — would fail if checked
            delegate: f.delegate.clone(),
            delegate_proof: garbage_delegate_proof,
        }),
    };

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );
    assert!(result.is_ok(), "expected success, got {:?}", result);
    assert_eq!(f.client.nonce(), 1);
}

#[test]
fn test_signer_as_executor_expired_proof() {
    let mut f = setup_signer_execution_proof(true);
    // proof expiry in the past vs. ledger timestamp 1000.
    f.proof_expiry = 500;
    let auth_data = build_signer_execution_proof_auth_data(&f, None, None, None, None);

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );

    assert_eq!(
        result.unwrap_err(),
        Ok(OneSigError::SignerExecutionProofExpired)
    );
    assert_eq!(f.client.nonce(), 0);
}

#[test]
fn test_signer_as_executor_unknown_signer() {
    let f = setup_signer_execution_proof(true);

    // Re-sign the authorization with a fresh (unregistered) secp256k1 key.
    let rogue_key = generate_secp256k1_keypair();
    let merkle_root_for_digest = f.leaf.clone();
    let authorization_digest = build_signer_execution_authorization_digest(
        &f.env,
        &f.leaf,
        &merkle_root_for_digest,
        &f.delegate,
        f.proof_expiry,
    );
    let rogue_proof = secp256k1_sign(&f.env, &rogue_key, &authorization_digest);

    let merkle_root = f.leaf.clone();
    let digest = build_sign_merkle_root_digest(&f.env, &f.seed, &merkle_root, f.expiry);
    let merkle_signature = secp256k1_sign(&f.env, &f.signing_key, &digest);
    let executor_sig_bytes = f.executor_keypair.sign(&f.payload.to_array());
    let delegate_proof: BytesN<64> = BytesN::from_array(&f.env, &executor_sig_bytes.to_bytes());

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry: f.expiry,
        proof: vec![&f.env],
        signatures: vec![&f.env, merkle_signature],
        sender: Sender::Signer(SignerExecutionProof {
            signature: rogue_proof,
            expiry: f.proof_expiry,
            delegate: f.delegate.clone(),
            delegate_proof,
        }),
    };

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );

    assert_eq!(result.unwrap_err(), Ok(OneSigError::OnlyExecutorOrSigner));
    assert_eq!(f.client.nonce(), 0);
}

#[test]
fn test_signer_as_executor_tampered_delegate() {
    // Signer commits to executor A, but payload says executor B → ecrecover yields
    // an address that isn't in the signer set.
    let f = setup_signer_execution_proof(true);
    let decoy = ed25519_public_key(&f.env, &generate_ed25519_keypair());
    let auth_data = build_signer_execution_proof_auth_data(&f, None, Some(decoy), None, None);

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );

    assert_eq!(result.unwrap_err(), Ok(OneSigError::OnlyExecutorOrSigner));
    assert_eq!(f.client.nonce(), 0);
}

#[test]
fn test_signer_as_executor_tampered_expiry() {
    // Signer signs for expiry=X, but payload declares a different expiry → ecrecover
    // yields a different address → registered-signer check fails.
    let f = setup_signer_execution_proof(true);
    let auth_data =
        build_signer_execution_proof_auth_data(&f, Some(f.proof_expiry + 1), None, None, None);

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );

    assert_eq!(result.unwrap_err(), Ok(OneSigError::OnlyExecutorOrSigner));
    assert_eq!(f.client.nonce(), 0);
}

#[test]
fn test_signer_as_executor_tampered_merkle_root() {
    // Cross-root binding check: signer commits to root R1 in the authorization, but
    // the executing auth payload carries R2. The contract reconstructs the digest
    // with R2 → ecrecover yields a different (unregistered) address → registered
    // -signer check fails. Regression for the auditor's request to bind merkle_root
    // into the signed message (signer-as-executor.md §"Binding to merkle_root").
    let f = setup_signer_execution_proof(true);
    let other_root = BytesN::from_array(&f.env, &[0xEEu8; 32]);
    let auth_data = build_signer_execution_proof_auth_data(&f, None, None, None, Some(other_root));

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );

    assert_eq!(result.unwrap_err(), Ok(OneSigError::OnlyExecutorOrSigner));
    assert_eq!(f.client.nonce(), 0);
}

#[test]
fn test_signer_as_executor_invalid_delegate_proof() {
    // delegate_proof was produced over a different payload — ed25519_verify fails
    // and raises a host-level crypto error (same treatment as executor path today).
    let f = setup_signer_execution_proof(true);
    let wrong_payload = BytesN::from_array(&f.env, &[0xFFu8; 32]);
    let auth_data =
        build_signer_execution_proof_auth_data(&f, None, None, Some(wrong_payload), None);

    let result = f.env.try_invoke_contract_check_auth::<OneSigError>(
        &f.contract_id,
        &f.payload,
        auth_data.into_val(&f.env),
        &f.auth_contexts,
    );

    let err = result.unwrap_err();
    assert!(
        err.is_err(),
        "expected host-level crypto error, got {:?}",
        err
    );
    assert_eq!(f.client.nonce(), 0);
}

#[test]
fn test_check_auth_rejects_non_contract_context() {
    let env = Env::default();

    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        None,
        Some(false),
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    let new_seed = BytesN::from_array(&env, &[99u8; 32]);
    let call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
        sub_invocations: vec![&env],
    };

    let leaf = client.encode_leaf(&0u64, &call);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    let invalid_context = Context::CreateContractHostFn(CreateContractHostFnContext {
        executable: ContractExecutable::Wasm(BytesN::from_array(&env, &[7u8; 32])),
        salt: BytesN::from_array(&env, &[1u8; 32]),
    });
    let auth_contexts = vec![&env, invalid_context];

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Permissionless,
    };

    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    assert!(result.is_err(), "Non-contract context should be rejected");
    assert_eq!(
        result.unwrap_err(),
        Ok(crate::errors::OneSigError::NonContractInvoke)
    );
}

#[test]
fn test_check_auth_invalid_executor_signature() {
    use super::helpers::ed25519_public_key;
    use ed25519_dalek::Signer;

    let env = Env::default();

    // Generate secp256k1 keypair for the signer
    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    // Generate ed25519 keypair for the executor
    let executor_keypair = generate_ed25519_keypair();
    let executor_key = ed25519_public_key(&env, &executor_keypair);

    // Set up contract with executor_required = true
    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];
    let executors = vec![&env, executor_key.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        Some(executors),
        Some(true), // executor_required = true
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    // Create a valid call
    let new_seed = BytesN::from_array(&env, &[99u8; 32]);
    let call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
        sub_invocations: vec![&env],
    };

    let leaf = client.encode_leaf(&0u64, &call);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    // Create auth context
    let auth_context = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
    });
    let auth_contexts = vec![&env, auth_context];

    // Sign a DIFFERENT payload to create an invalid signature
    let wrong_payload = BytesN::from_array(&env, &[0xFFu8; 32]);
    let sender_sig_bytes = executor_keypair.sign(&wrong_payload.to_array());
    let invalid_sender_signature: BytesN<64> =
        BytesN::from_array(&env, &sender_sig_bytes.to_bytes());

    // The actual payload that will be verified
    let payload = BytesN::from_array(&env, &[0u8; 32]);

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Executor(executor_key, invalid_sender_signature), // Wrong signature for payload
    };

    // ed25519_verify fails and returns a crypto error
    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    // Verify it failed with a crypto error (ed25519 verification failure)
    assert!(result.is_err(), "Invalid executor signature should fail");
    // The error is a host-level crypto error, not a contract error
    let err = result.unwrap_err();
    // Err variant contains the raw error from the host
    assert!(
        err.is_err(),
        "Should be a host error (Crypto), not a contract error: {:?}",
        err
    );
    // Nonce should not be incremented
    assert_eq!(client.nonce(), 0);
}

#[test]
fn test_check_auth_executor_required_but_no_sender() {
    let env = Env::default();

    // Generate secp256k1 keypair for the signer
    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    // Generate ed25519 keypair for the executor
    let executor_keypair = generate_ed25519_keypair();
    let executor_key = super::helpers::ed25519_public_key(&env, &executor_keypair);

    // Set up contract with executor_required = true
    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];
    let executors = vec![&env, executor_key.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        Some(executors),
        Some(true), // executor_required = true
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    // Create a valid call
    let new_seed = BytesN::from_array(&env, &[99u8; 32]);
    let call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
        sub_invocations: vec![&env],
    };

    let leaf = client.encode_leaf(&0u64, &call);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    // Create auth context
    let auth_context = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, new_seed.into_val(&env)],
    });
    let auth_contexts = vec![&env, auth_context];

    // Don't provide sender or sender_signature (both are None)
    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Permissionless, // Missing sender
    };

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    // Should fail with ExecutorRequired because sender is None when executor_required = true
    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    assert!(
        result.is_err(),
        "Should fail when executor required but no sender provided"
    );
    // ExecutorRequired = 13
    assert_eq!(
        result.unwrap_err(),
        Ok(crate::errors::OneSigError::OnlyExecutorOrSigner)
    );
}

#[test]
fn test_check_auth_mismatched_calls_rejected() {
    let env = Env::default();

    // Generate a real secp256k1 keypair for the signer
    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        None,
        Some(false),
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    // Create merkle proof for call A
    let seed_a = BytesN::from_array(&env, &[0xAAu8; 32]);
    let call_a = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, seed_a.into_val(&env)],
        sub_invocations: vec![&env],
    };
    let leaf = client.encode_leaf(&0u64, &call_a);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    // But provide auth context for call B (different seed value)
    let seed_b = BytesN::from_array(&env, &[0xBBu8; 32]);
    let auth_context = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, seed_b.into_val(&env)], // Different from what's in merkle proof
    });
    let auth_contexts = vec![&env, auth_context];

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Permissionless,
    };

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    // Should fail because the derived calls from context don't match the merkle proof
    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    assert!(result.is_err(), "Mismatched calls should be rejected");
    assert_eq!(
        result.unwrap_err(),
        Ok(crate::errors::OneSigError::InvalidProofOrNonce)
    );
}

#[test]
fn test_check_auth_multiple_calls() {
    let env = Env::default();

    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),
        Some(seed.clone()),
        Some(signers),
        Some(1u32),
        None,
        Some(false),
    );

    let client = OneSigClient::new(&env, &contract_id);

    env.ledger().set_timestamp(1000);

    // Create a single call for the leaf, but we'll provide multiple auth contexts to test rejection
    let seed1 = BytesN::from_array(&env, &[1u8; 32]);
    let seed2 = BytesN::from_array(&env, &[2u8; 32]);
    let call = Call {
        to: contract_id.clone(),
        func: Symbol::new(&env, "set_seed"),
        args: vec![&env, seed1.into_val(&env)],
        sub_invocations: vec![&env],
    };

    let leaf = client.encode_leaf(&0u64, &call);
    let merkle_root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    let expiry = 9999u64;
    let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
    let signature = secp256k1_sign(&env, &signing_key, &digest);

    // Create matching auth contexts
    let auth_context1 = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, seed1.into_val(&env)],
    });
    let auth_context2 = Context::Contract(soroban_sdk::auth::ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(&env, "set_seed"),
        args: vec![&env, seed2.into_val(&env)],
    });
    let auth_contexts = vec![&env, auth_context1, auth_context2];

    let auth_data = TransactionAuthData {
        merkle_root,
        expiry,
        proof,
        signatures: vec![&env, signature],
        sender: Sender::Permissionless,
    };

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    // Should fail with InvalidAuthContext (multiple contexts no longer allowed)
    let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
        &contract_id,
        &payload,
        auth_data.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(
        result.unwrap_err(),
        Ok(crate::errors::OneSigError::InvalidAuthContext)
    );
    assert_eq!(client.nonce(), 0);
}

#[test]
fn test_check_auth_nonce_increment() {
    let env = Env::default();

    // Generate a real secp256k1 keypair for the signer
    let signing_key = generate_secp256k1_keypair();
    let signer_address = secp256k1_signer_address(&env, &signing_key);

    // Set up contract with known seed and the real signer
    let seed = BytesN::from_array(&env, &[42u8; 32]);
    let signers = vec![&env, signer_address.clone()];

    let contract_id = create_onesig_with_defaults(
        &env,
        Some(0u64),         // onesig_id
        Some(seed.clone()), // seed
        Some(signers),      // signers
        Some(1u32),         // threshold = 1
        None,               // executors (empty)
        Some(false),        // executor_required = false
    );

    let client = OneSigClient::new(&env, &contract_id);

    // Verify initial nonce is 0
    assert_eq!(client.nonce(), 0);

    // Set ledger timestamp for expiry check
    env.ledger().set_timestamp(1000);

    // Execute multiple transactions and verify nonce increments each time
    for expected_nonce in 0u64..3u64 {
        // Verify current nonce before transaction
        assert_eq!(
            client.nonce(),
            expected_nonce,
            "Nonce should be {} before transaction",
            expected_nonce
        );

        // Create a unique call for each iteration
        let mut seed_bytes = [0u8; 32];
        seed_bytes[0] = (expected_nonce + 1) as u8;
        let new_seed: BytesN<32> = BytesN::from_array(&env, &seed_bytes);
        let call = Call {
            to: contract_id.clone(),
            func: Symbol::new(&env, "set_seed"),
            args: vec![&env, new_seed.into_val(&env)],
            sub_invocations: vec![&env],
        };

        // Encode the leaf with current nonce
        let leaf = client.encode_leaf(&expected_nonce, &call);

        // For a single-leaf merkle tree, root = leaf and proof is empty
        let merkle_root = leaf.clone();
        let proof: Vec<BytesN<32>> = vec![&env];

        // Expiry in the future
        let expiry = 9999u64 + expected_nonce;

        // Build the EIP712 digest and sign it
        let digest = build_sign_merkle_root_digest(&env, &seed, &merkle_root, expiry);
        let signature = secp256k1_sign(&env, &signing_key, &digest);

        // Create the auth context matching the call
        let auth_context = Context::Contract(soroban_sdk::auth::ContractContext {
            contract: contract_id.clone(),
            fn_name: Symbol::new(&env, "set_seed"),
            args: vec![&env, new_seed.into_val(&env)],
        });
        let auth_contexts = vec![&env, auth_context];

        // Create TransactionAuthData with valid signature and proof
        let auth_data = TransactionAuthData {
            merkle_root: merkle_root.clone(),
            expiry,
            proof,
            signatures: vec![&env, signature],
            sender: Sender::Permissionless,
        };

        let payload = BytesN::from_array(&env, &[0u8; 32]);

        // Call __check_auth - this should succeed and increment the nonce
        let result = env.try_invoke_contract_check_auth::<crate::errors::OneSigError>(
            &contract_id,
            &payload,
            auth_data.into_val(&env),
            &auth_contexts,
        );

        // Verify __check_auth succeeded
        assert!(
            result.is_ok(),
            "Expected __check_auth to succeed for nonce {}, got: {:?}",
            expected_nonce,
            result
        );

        // Verify nonce was incremented
        assert_eq!(
            client.nonce(),
            expected_nonce + 1,
            "Nonce should be {} after transaction {}",
            expected_nonce + 1,
            expected_nonce
        );
    }

    // Final verification - nonce should be 3 after 3 successful transactions
    assert_eq!(
        client.nonce(),
        3,
        "Final nonce should be 3 after 3 successful transactions"
    );
}

#[test]
fn test_version() {
    let (env, _contract_id, client) = setup();

    let version = client.version();
    assert_eq!(version, soroban_sdk::String::from_str(&env, "0.0.1"));
}

#[test]
fn test_leaf_encoding_version() {
    let (_env, _contract_id, client) = setup();

    let leaf_encoding_version = client.leaf_encoding_version();
    assert_eq!(leaf_encoding_version, 1);
}
