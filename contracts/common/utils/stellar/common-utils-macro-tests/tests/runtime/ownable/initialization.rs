// Runtime tests: Owner initialization behavior.
//
// Tests covered:
// - `init_owner` + `owner()` query works correctly.
// - Double initialization is rejected.
// - Uninitialized owner returns None and operations fail.

use super::{TestContract, TestContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env};
use utils::errors::{AuthError, OwnableError};

#[test]
fn init_and_query() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    let got = client.owner();
    assert_eq!(got, Some(owner));
}

#[test]
fn double_init_fails() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner_a = Address::generate(&env);
    let owner_b = Address::generate(&env);

    // First initialization should succeed
    client.init(&owner_a);
    assert_eq!(client.owner(), Some(owner_a.clone()));

    // Second initialization should fail
    let result = client.try_init(&owner_b);
    assert_eq!(result.unwrap_err().unwrap(), OwnableError::OwnerAlreadySet.into());

    // Original owner should remain unchanged
    assert_eq!(client.owner(), Some(owner_a));
}

#[test]
fn uninitialized_returns_none() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    // No init() call - owner should be None
    assert_eq!(client.owner(), None);

    // authorizer() returns None when owner is not set (no panic)
    assert_eq!(client.authorizer(), None);

    // guarded() uses require_auth -> AuthorizerNotFound when authorizer is None
    assert_eq!(client.try_guarded().unwrap_err().unwrap(), AuthError::AuthorizerNotFound.into());
    // transfer/renounce use enforce_owner_auth -> OwnerNotSet when owner is None
    assert_eq!(
        client.try_transfer_ownership(&Address::generate(&env)).unwrap_err().unwrap(),
        OwnableError::OwnerNotSet.into()
    );
    assert_eq!(client.try_renounce_ownership().unwrap_err().unwrap(), OwnableError::OwnerNotSet.into());
}

#[test]
fn authorizer_returns_owner() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    client.init(&owner);

    assert_eq!(client.authorizer(), Some(owner));
}
