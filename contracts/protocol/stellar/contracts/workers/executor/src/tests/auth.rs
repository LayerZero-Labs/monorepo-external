use super::setup::{Ed25519KeyPair, TestSetup};
use crate::auth::ExecutorSignature;
use crate::errors::ExecutorError;
use soroban_sdk::auth::{Context, ContractContext, CreateContractHostFnContext};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{vec, Address, BytesN, Env, IntoVal, Symbol, Val, Vec};

fn mk_sig(setup: &TestSetup<'_>, admin_kp: &Ed25519KeyPair, payload: &BytesN<32>) -> ExecutorSignature {
    ExecutorSignature {
        public_key: admin_kp.public_key(&setup.env),
        signature: admin_kp.sign_payload(&setup.env, payload),
    }
}

fn contract_ctx(env: &Env, contract: Address, fn_name: &str, args: Vec<Val>) -> Context {
    Context::Contract(ContractContext { contract, fn_name: Symbol::new(env, fn_name), args })
}

fn check_auth(
    setup: &TestSetup<'_>,
    payload: &BytesN<32>,
    sig: ExecutorSignature,
    auth_contexts: &Vec<Context>,
) -> Result<(), Result<ExecutorError, soroban_sdk::InvokeError>> {
    setup.env.try_invoke_contract_check_auth::<ExecutorError>(
        &setup.contract_id,
        payload,
        sig.into_val(&setup.env),
        auth_contexts,
    )
}

#[test]
fn test_check_auth_allows_lz_receive_value_zero() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    // Helper context + lz_receive with value = 0 → 2 contexts
    let oapp = Address::generate(&setup.env);
    let args: Vec<Val> = vec![&setup.env, 0i128.into_val(&setup.env)];
    let auth_contexts: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", args),
    ];

    let res = check_auth(&setup, &payload, sig, &auth_contexts);
    assert!(res.is_ok(), "Expected success, got {:?}", res);
}

#[test]
fn test_check_auth_allows_lz_compose_value_zero() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    // Helper context + lz_compose with value = 0 → 2 contexts
    let composer = Address::generate(&setup.env);
    let args: Vec<Val> = vec![&setup.env, 0i128.into_val(&setup.env)];
    let auth_contexts: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "compose", Vec::new(&setup.env)),
        contract_ctx(&setup.env, composer, "lz_compose", args),
    ];

    let res = check_auth(&setup, &payload, sig, &auth_contexts);
    assert!(res.is_ok(), "Expected success, got {:?}", res);
}

#[test]
fn test_check_auth_allows_value_transfer_when_value_nonzero() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    // Helper context + lz_receive with value != 0 + transfer → 3 contexts
    let value: i128 = 123;
    let oapp = Address::generate(&setup.env);
    let exec_args: Vec<Val> = vec![&setup.env, value.into_val(&setup.env)];

    let from = Address::generate(&setup.env);
    let to = Address::generate(&setup.env);
    let transfer_args: Vec<Val> =
        vec![&setup.env, from.into_val(&setup.env), to.into_val(&setup.env), value.into_val(&setup.env)];

    let auth_contexts: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", exec_args),
        contract_ctx(&setup.env, setup.native_token.clone(), "transfer", transfer_args),
    ];

    let res = check_auth(&setup, &payload, sig, &auth_contexts);
    assert!(res.is_ok(), "Expected success, got {:?}", res);
}

#[test]
fn test_check_auth_allows_alert_calls_only_on_endpoint() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    let empty_args: Vec<Val> = Vec::new(&setup.env);
    for fn_name in ["lz_receive_alert", "lz_compose_alert"] {
        let contexts: Vec<Context> =
            vec![&setup.env, contract_ctx(&setup.env, setup.endpoint.clone(), fn_name, empty_args.clone())];
        let res = check_auth(&setup, &payload, sig.clone(), &contexts);
        assert!(res.is_ok(), "Expected success for {fn_name}, got {:?}", res);
    }
}

#[test]
fn test_check_auth_rejects_signature_mismatch() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let other_kp = Ed25519KeyPair::generate();

    // Admin pubkey is registered, but signature is produced by a different key.
    let sig = ExecutorSignature {
        public_key: admin_kp.public_key(&setup.env),
        signature: other_kp.sign_payload(&setup.env, &payload),
    };

    let oapp = Address::generate(&setup.env);
    let args: Vec<Val> = vec![&setup.env, 0i128.into_val(&setup.env)];
    let contexts: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", args),
    ];

    let res = check_auth(&setup, &payload, sig, &contexts);
    assert!(matches!(res, Err(Err(_))), "Expected host error, got {:?}", res);
}

#[test]
fn test_check_auth_rejects_non_admin() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let oapp = Address::generate(&setup.env);
    let args: Vec<Val> = vec![&setup.env, 0i128.into_val(&setup.env)];
    let contexts: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", args),
    ];

    // Unauthorized: signer not in admins list
    let non_admin_kp = Ed25519KeyPair::generate();
    let sig = ExecutorSignature {
        public_key: non_admin_kp.public_key(&setup.env),
        signature: non_admin_kp.sign_payload(&setup.env, &payload),
    };

    let res = check_auth(&setup, &payload, sig, &contexts);
    assert_eq!(res, Err(Ok(ExecutorError::Unauthorized)));
}

#[test]
fn test_check_auth_rejects_empty_or_too_many_contexts() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    // Empty contexts
    let empty: Vec<Context> = Vec::new(&setup.env);
    assert_eq!(check_auth(&setup, &payload, sig.clone(), &empty), Err(Ok(ExecutorError::UnauthorizedContext)));

    // Too many contexts (>3)
    let oapp = Address::generate(&setup.env);
    let args0: Vec<Val> = vec![&setup.env, 0i128.into_val(&setup.env)];
    let too_many: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp.clone(), "lz_receive", args0.clone()),
        contract_ctx(&setup.env, oapp.clone(), "lz_receive", args0.clone()),
        contract_ctx(&setup.env, oapp, "lz_receive", args0),
    ];
    assert_eq!(check_auth(&setup, &payload, sig, &too_many), Err(Ok(ExecutorError::UnauthorizedContext)));
}

#[test]
fn test_check_auth_rejects_non_contract_first_context() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    let create_ctx: Vec<Context> = vec![
        &setup.env,
        Context::CreateContractHostFn(CreateContractHostFnContext {
            executable: soroban_sdk::auth::ContractExecutable::Wasm(BytesN::from_array(&setup.env, &[2u8; 32])),
            salt: BytesN::from_array(&setup.env, &[3u8; 32]),
        }),
    ];
    assert_eq!(check_auth(&setup, &payload, sig, &create_ctx), Err(Ok(ExecutorError::UnauthorizedContext)));
}

#[test]
fn test_check_auth_rejects_invalid_helper_fn_name() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    // Helper context with unregistered function name
    let oapp = Address::generate(&setup.env);
    let bad_fn: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "not_allowed", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", vec![&setup.env, 0i128.into_val(&setup.env)]),
    ];
    assert_eq!(check_auth(&setup, &payload, sig.clone(), &bad_fn), Err(Ok(ExecutorError::UnauthorizedContext)));

    // Wrong helper address
    let wrong_helper = Address::generate(&setup.env);
    let bad_addr: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, wrong_helper, "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, Address::generate(&setup.env), "lz_receive", vec![&setup.env, 0i128.into_val(&setup.env)]),
    ];
    assert_eq!(check_auth(&setup, &payload, sig, &bad_addr), Err(Ok(ExecutorError::UnauthorizedContext)));
}

#[test]
fn test_check_auth_rejects_invalid_alert_contexts() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    let oapp = Address::generate(&setup.env);

    // Alert fn must target endpoint and must be the only context
    let bad_alert_contract: Vec<Context> =
        vec![&setup.env, contract_ctx(&setup.env, oapp.clone(), "lz_receive_alert", Vec::new(&setup.env))];
    assert_eq!(
        check_auth(&setup, &payload, sig.clone(), &bad_alert_contract),
        Err(Ok(ExecutorError::UnauthorizedContext))
    );

    let bad_alert_extra_ctx: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.endpoint.clone(), "lz_receive_alert", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", vec![&setup.env, 0i128.into_val(&setup.env)]),
    ];
    assert_eq!(check_auth(&setup, &payload, sig, &bad_alert_extra_ctx), Err(Ok(ExecutorError::UnauthorizedContext)));
}

#[test]
fn test_check_auth_rejects_execute_missing_or_wrong_value_type() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    let oapp = Address::generate(&setup.env);

    // lz_receive requires last arg to be i128 value
    let missing_value: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp.clone(), "lz_receive", Vec::new(&setup.env)),
    ];
    assert_eq!(check_auth(&setup, &payload, sig.clone(), &missing_value), Err(Ok(ExecutorError::UnauthorizedContext)));

    let wrong_value_type: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(
            &setup.env,
            oapp,
            "lz_receive",
            vec![&setup.env, Symbol::new(&setup.env, "not_i128").into_val(&setup.env)],
        ),
    ];
    assert_eq!(check_auth(&setup, &payload, sig, &wrong_value_type), Err(Ok(ExecutorError::UnauthorizedContext)));
}

#[test]
fn test_check_auth_rejects_value_zero_with_extra_context() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    let oapp = Address::generate(&setup.env);
    let value_zero_with_transfer: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", vec![&setup.env, 0i128.into_val(&setup.env)]),
        contract_ctx(
            &setup.env,
            setup.native_token.clone(),
            "transfer",
            vec![
                &setup.env,
                Address::generate(&setup.env).into_val(&setup.env),
                Address::generate(&setup.env).into_val(&setup.env),
                1i128.into_val(&setup.env),
            ],
        ),
    ];
    assert_eq!(
        check_auth(&setup, &payload, sig, &value_zero_with_transfer),
        Err(Ok(ExecutorError::UnauthorizedContext))
    );
}

#[test]
fn test_check_auth_rejects_value_nonzero_missing_transfer_context() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    let oapp = Address::generate(&setup.env);
    let value_nonzero_missing_transfer: Vec<Context> = vec![
        &setup.env,
        contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env)),
        contract_ctx(&setup.env, oapp, "lz_receive", vec![&setup.env, 1i128.into_val(&setup.env)]),
    ];
    assert_eq!(
        check_auth(&setup, &payload, sig, &value_nonzero_missing_transfer),
        Err(Ok(ExecutorError::UnauthorizedContext))
    );
}

#[test]
fn test_check_auth_rejects_invalid_transfer_context() {
    let env = Env::default();
    let admin_kp = Ed25519KeyPair::generate();
    let admin_addr = admin_kp.address(&env);
    let setup = TestSetup::new_with_env_and_admin(env, &admin_addr);

    let payload = BytesN::from_array(&setup.env, &[1u8; 32]);
    let sig = mk_sig(&setup, &admin_kp, &payload);

    let helper_ctx: Context = contract_ctx(&setup.env, setup.executor_helper.clone(), "execute", Vec::new(&setup.env));
    let oapp = Address::generate(&setup.env);
    let base_exec: Context = contract_ctx(&setup.env, oapp, "lz_receive", vec![&setup.env, 5i128.into_val(&setup.env)]);
    let transfer_args: Vec<Val> = vec![
        &setup.env,
        Address::generate(&setup.env).into_val(&setup.env),
        Address::generate(&setup.env).into_val(&setup.env),
        5i128.into_val(&setup.env),
    ];

    // Wrong transfer fn name
    let wrong_transfer_fn: Vec<Context> = vec![
        &setup.env,
        helper_ctx.clone(),
        base_exec.clone(),
        contract_ctx(&setup.env, setup.native_token.clone(), "not_transfer", transfer_args.clone()),
    ];
    assert_eq!(
        check_auth(&setup, &payload, sig.clone(), &wrong_transfer_fn),
        Err(Ok(ExecutorError::UnauthorizedContext))
    );

    // Wrong transfer contract
    let wrong_transfer_contract: Vec<Context> = vec![
        &setup.env,
        helper_ctx.clone(),
        base_exec.clone(),
        contract_ctx(&setup.env, Address::generate(&setup.env), "transfer", transfer_args.clone()),
    ];
    assert_eq!(
        check_auth(&setup, &payload, sig.clone(), &wrong_transfer_contract),
        Err(Ok(ExecutorError::UnauthorizedContext))
    );

    // Wrong transfer amount (must match value)
    let wrong_transfer_amount: Vec<Context> = vec![
        &setup.env,
        helper_ctx,
        base_exec,
        contract_ctx(
            &setup.env,
            setup.native_token.clone(),
            "transfer",
            vec![
                &setup.env,
                Address::generate(&setup.env).into_val(&setup.env),
                Address::generate(&setup.env).into_val(&setup.env),
                6i128.into_val(&setup.env),
            ],
        ),
    ];
    assert_eq!(check_auth(&setup, &payload, sig, &wrong_transfer_amount), Err(Ok(ExecutorError::UnauthorizedContext)));
}
