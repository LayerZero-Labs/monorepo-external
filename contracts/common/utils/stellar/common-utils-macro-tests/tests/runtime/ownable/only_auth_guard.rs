// Runtime tests: `#[only_auth]` guard behavior.
//
// Tests covered:
// - Guard enforces owner authorization (unauthorized fails, authorized succeeds).
// - Guard respects ownership transfer (old owner rejected, new owner accepted).

use super::{TestContract, TestContractClient};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal,
};

#[test]
fn guard_enforces_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    // Unauthorized call should fail
    let unauthorized = client.try_guarded();
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Authorized call should succeed
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "guarded",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .guarded();
}

#[test]
fn guard_respects_transfer() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner_a = Address::generate(&env);
    let owner_b = Address::generate(&env);

    client.init(&owner_a);

    // Transfer ownership A -> B
    client
        .mock_auths(&[MockAuth {
            address: &owner_a,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "transfer_ownership",
                args: (&owner_b,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .transfer_ownership(&owner_b);

    // Old owner (A) should be rejected even with auth
    let a_call = client
        .mock_auths(&[MockAuth {
            address: &owner_a,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "guarded",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_guarded();
    assert_eq!(
        a_call.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // New owner (B) should be accepted with auth
    client
        .mock_auths(&[MockAuth {
            address: &owner_b,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "guarded",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .guarded();
}
