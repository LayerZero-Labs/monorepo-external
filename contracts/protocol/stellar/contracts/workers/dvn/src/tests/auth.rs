use crate::{
    errors::DvnError,
    tests::setup::{TestSetup, VID},
    Call, LzDVNClient, Sender, TransactionAuthData,
};
use ed25519_dalek::{Signer, SigningKey};
use rand::thread_rng;
use soroban_sdk::{
    auth::{ContractContext, Context},
    testutils::Address as _,
    vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec,
};

struct Ed25519KeyPair {
    signing_key: SigningKey,
}

impl Ed25519KeyPair {
    fn generate() -> Self {
        Self { signing_key: SigningKey::generate(&mut thread_rng()) }
    }

    fn public_key_bytes(&self) -> [u8; 32] {
        self.signing_key.verifying_key().to_bytes()
    }

    fn public_key(&self, env: &Env) -> BytesN<32> {
        self.public_key_bytes().into_val(env)
    }

    fn sign(&self, env: &Env, message: &[u8; 32]) -> BytesN<64> {
        let sig = self.signing_key.sign(message);
        BytesN::from_array(env, &sig.to_bytes())
    }
}

/// Creates a single self-call auth context and matching Call for testing.
fn make_self_call_context(
    env: &Env,
    contract_id: &soroban_sdk::Address,
) -> (Vec<Context>, Vec<Call>) {
    let fn_name = Symbol::new(env, "set_paused");
    let args: Vec<Val> = vec![env, true.into_val(env)];

    let context = Context::Contract(ContractContext {
        contract: contract_id.clone(),
        fn_name: fn_name.clone(),
        args: args.clone(),
    });
    let auth_contexts = vec![env, context];

    let calls = vec![env, Call { to: contract_id.clone(), func: fn_name, args }];

    (auth_contexts, calls)
}

/// Creates upgrade auth contexts (3 entries: upgrader call, upgrade, migrate).
fn make_upgrade_contexts(
    env: &Env,
    contract_id: &soroban_sdk::Address,
    upgrader_id: &soroban_sdk::Address,
) -> (Vec<Context>, Vec<Call>) {
    let wasm_hash_val: Val = BytesN::from_array(env, &[0xABu8; 32]).into_val(env);
    let migration_data_val: Val = soroban_sdk::Bytes::new(env).into_val(env);

    // [0]: Upgrader call
    let upgrader_ctx = Context::Contract(ContractContext {
        contract: upgrader_id.clone(),
        fn_name: Symbol::new(env, "upgrade_and_migrate"),
        args: vec![
            env,
            contract_id.clone().into_val(env),
            wasm_hash_val.clone(),
            migration_data_val.clone(),
        ],
    });
    // [1]: upgrade self-call
    let upgrade_ctx = Context::Contract(ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(env, "upgrade"),
        args: vec![env, wasm_hash_val],
    });
    // [2]: migrate self-call
    let migrate_ctx = Context::Contract(ContractContext {
        contract: contract_id.clone(),
        fn_name: Symbol::new(env, "migrate"),
        args: vec![env, migration_data_val],
    });

    let auth_contexts = vec![env, upgrader_ctx.clone(), upgrade_ctx.clone(), migrate_ctx.clone()];

    // Build matching Call vec
    let calls = vec![
        env,
        Call {
            to: upgrader_id.clone(),
            func: Symbol::new(env, "upgrade_and_migrate"),
            args: match &upgrader_ctx {
                Context::Contract(c) => c.args.clone(),
                _ => unreachable!(),
            },
        },
        Call {
            to: contract_id.clone(),
            func: Symbol::new(env, "upgrade"),
            args: match &upgrade_ctx {
                Context::Contract(c) => c.args.clone(),
                _ => unreachable!(),
            },
        },
        Call {
            to: contract_id.clone(),
            func: Symbol::new(env, "migrate"),
            args: match &migrate_ctx {
                Context::Contract(c) => c.args.clone(),
                _ => unreachable!(),
            },
        },
    ];

    (auth_contexts, calls)
}

// ============================================================================
// Single Self-Call Tests
// ============================================================================

#[test]
fn test_check_auth_success() {
    extern crate std;
    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;
    let (auth_contexts, calls) = make_self_call_context(&env, &setup.contract_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert!(res.is_ok(), "Expected success, got {:?}", res);
}

#[test]
fn test_check_auth_not_admin() {
    extern crate std;
    let non_admin_kp = Ed25519KeyPair::generate();

    let setup = TestSetup::new(1);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;
    let (auth_contexts, calls) = make_self_call_context(&env, &setup.contract_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = non_admin_kp.public_key(&env);
    let signature = non_admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::OnlyAdmin)));
}

#[test]
fn test_check_auth_wrong_signer_fails() {
    extern crate std;
    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;
    let (auth_contexts, calls) = make_self_call_context(&env, &setup.contract_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let wrong_sig = crate::tests::key_pair::KeyPair::generate().sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, wrong_sig],
        sender: Sender::Admin(public_key, signature),
    };

    // verify_signatures panics with MultiSigError::SignerNotFound when signer is not found
    let res = env.try_invoke_contract_check_auth::<utils::errors::MultiSigError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(utils::errors::MultiSigError::SignerNotFound)));
}

#[test]
fn test_check_auth_invalid_vid_fails() {
    extern crate std;
    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;
    let wrong_vid = VID + 1;
    let (auth_contexts, calls) = make_self_call_context(&env, &setup.contract_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&wrong_vid, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: wrong_vid,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::InvalidVid)));
}

#[test]
fn test_check_auth_expired_fails() {
    extern crate std;
    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp();
    let (auth_contexts, calls) = make_self_call_context(&env, &setup.contract_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::AuthDataExpired)));
}

#[test]
fn test_check_auth_hash_already_used_fails() {
    extern crate std;
    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;
    let (auth_contexts, calls) = make_self_call_context(&env, &setup.contract_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig.clone()],
        sender: Sender::Admin(public_key.clone(), signature.clone()),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );
    assert!(res.is_ok());

    let tx_auth2 = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res2 = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth2.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res2, Err(Ok(DvnError::HashAlreadyUsed)));
}

#[test]
fn test_check_auth_sender_none_fails_when_admin_required() {
    extern crate std;
    use crate::Sender;

    let setup = TestSetup::new(1);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;
    let (auth_contexts, calls) = make_self_call_context(&env, &setup.contract_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    // Use Sender::None which should fail when admin is required
    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::None,
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::OnlyAdmin)));
}

#[test]
fn test_check_auth_set_admin_bypasses_admin_verification() {
    extern crate std;
    use crate::Sender;

    let setup = TestSetup::new(1);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    // Create a context for set_admin call on the DVN contract
    let set_admin_context = Context::Contract(ContractContext {
        contract: setup.contract_id.clone(),
        fn_name: Symbol::new(&env, "set_admin"),
        args: Vec::new(&env),
    });
    let auth_contexts: Vec<Context> = vec![&env, set_admin_context];

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    let calls: Vec<Call> = vec![
        &env,
        Call {
            to: setup.contract_id.clone(),
            func: Symbol::new(&env, "set_admin"),
            args: Vec::new(&env),
        },
    ];

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    // Use Sender::None - should succeed for set_admin since it bypasses admin verification
    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::None,
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    // Should succeed because set_admin bypasses admin verification
    assert!(res.is_ok(), "Expected success for set_admin call, got {:?}", res);
}

#[test]
fn test_check_auth_non_contract_context_fails() {
    extern crate std;
    use crate::Sender;
    use soroban_sdk::auth::{ContractExecutable, CreateContractHostFnContext};

    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    // Create a non-Contract context (CreateContractHostFn)
    let non_contract_context = Context::CreateContractHostFn(CreateContractHostFnContext {
        executable: ContractExecutable::Wasm(BytesN::from_array(&env, &[0; 32])),
        salt: BytesN::from_array(&env, &[0; 32]),
    });
    let auth_contexts: Vec<Context> = vec![&env, non_contract_context];

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let dummy_calls: Vec<Call> =
        vec![&env, Call { to: setup.contract_id.clone(), func: Symbol::new(&env, "noop"), args: Vec::new(&env) }];
    let hash = dvn_client.hash_call_data(&VID, &expiration, &dummy_calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    // Should fail with NonContractInvoke error
    assert_eq!(res, Err(Ok(DvnError::NonContractInvoke)));
}

#[test]
fn test_check_auth_rejects_empty_contexts() {
    extern crate std;
    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;
    let auth_contexts: Vec<Context> = Vec::new(&env);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let dummy_calls: Vec<Call> =
        vec![&env, Call { to: setup.contract_id.clone(), func: Symbol::new(&env, "noop"), args: Vec::new(&env) }];
    let hash = dvn_client.hash_call_data(&VID, &expiration, &dummy_calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::InvalidAuthContext)));
}

#[test]
fn test_check_auth_rejects_external_target() {
    extern crate std;
    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    // Create a context targeting a different contract
    let other_setup = TestSetup::new(1);
    let other_contract = other_setup.contract_id;
    let external_context = Context::Contract(ContractContext {
        contract: other_contract,
        fn_name: Symbol::new(&env, "some_fn"),
        args: Vec::new(&env),
    });
    let auth_contexts: Vec<Context> = vec![&env, external_context];

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let dummy_calls: Vec<Call> =
        vec![&env, Call { to: setup.contract_id.clone(), func: Symbol::new(&env, "noop"), args: Vec::new(&env) }];
    let hash = dvn_client.hash_call_data(&VID, &expiration, &dummy_calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::InvalidAuthContext)));
}

// ============================================================================
// set_upgrader Tests
// ============================================================================

#[test]
fn test_set_upgrader_requires_admin() {
    extern crate std;
    use crate::Sender;

    let setup = TestSetup::new(1);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    let set_upgrader_context = Context::Contract(ContractContext {
        contract: setup.contract_id.clone(),
        fn_name: Symbol::new(&env, "set_upgrader"),
        args: Vec::new(&env),
    });
    let auth_contexts: Vec<Context> = vec![&env, set_upgrader_context];

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    let calls: Vec<Call> = vec![
        &env,
        Call {
            to: setup.contract_id.clone(),
            func: Symbol::new(&env, "set_upgrader"),
            args: Vec::new(&env),
        },
    ];

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::None,
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::OnlyAdmin)));
}

// ============================================================================
// Upgrade Path Tests
// ============================================================================

#[test]
fn test_check_auth_upgrade_success() {
    extern crate std;

    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    let upgrader_id = Address::generate(&env);
    env.as_contract(&setup.contract_id, || {
        crate::storage::DvnStorage::set_upgrader(&env, &upgrader_id);
    });

    let (auth_contexts, calls) = make_upgrade_contexts(&env, &setup.contract_id, &upgrader_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert!(res.is_ok(), "Expected success for upgrade, got {:?}", res);
}

#[test]
fn test_check_auth_upgrade_no_upgrader_set() {
    extern crate std;

    let setup = TestSetup::new(1);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    // Don't register any upgrader
    let fake_upgrader = TestSetup::new(1).contract_id;
    let (auth_contexts, calls) = make_upgrade_contexts(&env, &setup.contract_id, &fake_upgrader);

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::None,
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::UpgraderNotSet)));
}

#[test]
fn test_check_auth_upgrade_wrong_upgrader() {
    extern crate std;

    let setup = TestSetup::new(1);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    // Register one upgrader
    let registered_upgrader = Address::generate(&env);
    env.as_contract(&setup.contract_id, || {
        crate::storage::DvnStorage::set_upgrader(&env, &registered_upgrader);
    });

    // But use a different upgrader in the auth contexts
    let wrong_upgrader = Address::generate(&env);
    let (auth_contexts, calls) = make_upgrade_contexts(&env, &setup.contract_id, &wrong_upgrader);

    let payload = BytesN::from_array(&env, &[0u8; 32]);

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::None,
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res, Err(Ok(DvnError::InvalidUpgradeContext)));
}

#[test]
fn test_check_auth_upgrade_missing_migrate() {
    extern crate std;

    let setup = TestSetup::new(1);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    let upgrader_id = TestSetup::new(1).contract_id;
    env.as_contract(&setup.contract_id, || {
        crate::storage::DvnStorage::set_upgrader(&env, &upgrader_id);
    });

    // Only 2 contexts: upgrader + upgrade (missing migrate) → InvalidAuthContext (len != 1 and != 3)
    let upgrader_ctx = Context::Contract(ContractContext {
        contract: upgrader_id.clone(),
        fn_name: Symbol::new(&env, "upgrade_and_migrate"),
        args: Vec::new(&env),
    });
    let upgrade_ctx = Context::Contract(ContractContext {
        contract: setup.contract_id.clone(),
        fn_name: Symbol::new(&env, "upgrade"),
        args: Vec::new(&env),
    });
    let auth_contexts: Vec<Context> = vec![&env, upgrader_ctx, upgrade_ctx];

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let dummy_calls: Vec<Call> =
        vec![&env, Call { to: setup.contract_id.clone(), func: Symbol::new(&env, "noop"), args: Vec::new(&env) }];

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &dummy_calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::None,
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );

    // 2 contexts is neither 1 (single-call) nor 3 (upgrade), so InvalidAuthContext
    assert_eq!(res, Err(Ok(DvnError::InvalidAuthContext)));
}

#[test]
fn test_check_auth_upgrade_replay_protection() {
    extern crate std;

    let admin_kp = Ed25519KeyPair::generate();
    let admin_bytes = admin_kp.public_key_bytes();

    let setup = TestSetup::with_admin_bytes(1, std::vec![admin_bytes]);
    let env = setup.env.clone();
    let expiration = env.ledger().timestamp() + 1000;

    let upgrader_id = Address::generate(&env);
    env.as_contract(&setup.contract_id, || {
        crate::storage::DvnStorage::set_upgrader(&env, &upgrader_id);
    });

    let (auth_contexts, calls) = make_upgrade_contexts(&env, &setup.contract_id, &upgrader_id);

    let payload = BytesN::from_array(&env, &[0u8; 32]);
    let public_key = admin_kp.public_key(&env);
    let signature = admin_kp.sign(&env, &payload.to_array());

    let dvn_client = LzDVNClient::new(&env, &setup.contract_id);
    let hash = dvn_client.hash_call_data(&VID, &expiration, &calls);
    let sig = setup.key_pairs[0].sign_bytes(&env, &hash);

    let tx_auth = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig.clone()],
        sender: Sender::Admin(public_key.clone(), signature.clone()),
    };

    let res = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth.into_val(&env),
        &auth_contexts,
    );
    assert!(res.is_ok());

    // Second attempt with same data should fail
    let tx_auth2 = TransactionAuthData {
        vid: VID,
        expiration,
        signatures: vec![&env, sig],
        sender: Sender::Admin(public_key, signature),
    };

    let res2 = env.try_invoke_contract_check_auth::<DvnError>(
        &setup.contract_id,
        &payload,
        tx_auth2.into_val(&env),
        &auth_contexts,
    );

    assert_eq!(res2, Err(Ok(DvnError::HashAlreadyUsed)));
}
