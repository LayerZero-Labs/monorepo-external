use super::{TestContract, TestContractClient};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal,
};

#[test]
fn has_role_allows_member_and_rejects_non_member() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let other = Address::generate(&env);

    client.init(&admin, &minter);

    // Member call should succeed.
    client.has_role_guarded(&minter);

    // Non-member call should fail with RBAC Unauthorized.
    let res = client.try_has_role_guarded(&other);
    assert_eq!(res.err().unwrap().ok().unwrap(), utils::errors::RbacError::Unauthorized.into());
}

#[test]
fn only_role_enforces_require_auth_and_role_membership() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let other = Address::generate(&env);

    client.init(&admin, &minter);

    // 1) Role holder without auth should fail at `require_auth()`.
    let no_auth = client.try_only_role_guarded(&minter);
    assert_eq!(
        no_auth.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // 2) With auth but role missing, should fail with RBAC Unauthorized.
    let missing_role_with_auth = client
        .mock_auths(&[MockAuth {
            address: &other,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "only_role_guarded",
                args: (&other,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_only_role_guarded(&other);
    assert_eq!(missing_role_with_auth.err().unwrap().ok().unwrap(), utils::errors::RbacError::Unauthorized.into());

    // 3) With auth + role, should succeed.
    client
        .mock_auths(&[MockAuth {
            address: &minter,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "only_role_guarded",
                args: (&minter,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .only_role_guarded(&minter);
}

#[test]
fn only_role_checks_role_before_require_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let minter = Address::generate(&env);
    let other = Address::generate(&env);

    client.init(&admin, &minter);

    // No auth, no role: current macro expansion checks role first, so this should
    // return RBAC Unauthorized (not an auth error).
    let res = client.try_only_role_guarded(&other);
    assert_eq!(res.err().unwrap().ok().unwrap(), utils::errors::RbacError::Unauthorized.into());
}
