extern crate std;

use crate::auth::{enforce_auth, require_auth, Auth};
use crate::tests::test_helper::mock_auth;
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, Symbol};

// ============================================
// Test Contract for auth helpers
// ============================================

#[contract]
pub struct AuthTestContract;

fn authorizer_key(env: &Env) -> Symbol {
    Symbol::new(env, "authorizer")
}

#[contractimpl]
impl AuthTestContract {
    pub fn __constructor(env: &Env, authorizer: &Address) {
        env.storage().instance().set(&authorizer_key(env), authorizer);
    }

    /// Test-only helper to update the authorizer in instance storage.
    ///
    /// NOTE: This is intentionally *not* protected by auth, since it's only used in unit tests.
    pub fn set_authorizer(env: &Env, authorizer: &Address) {
        env.storage().instance().set(&authorizer_key(env), authorizer);
    }

    pub fn enforce_auth_for_test(env: &Env) -> Address {
        enforce_auth::<Self>(env)
    }

    pub fn require_auth_for_test(env: &Env) {
        require_auth::<Self>(env);
    }
}

/// `Auth` implementation for the test contract - uses a stored address as the authorizer.
impl Auth for AuthTestContract {
    fn authorizer(env: &Env) -> Option<Address> {
        env.storage().instance().get(&authorizer_key(env))
    }
}

// ============================================
// enforce_auth
// ============================================

#[test]
fn test_enforce_auth_returns_authorizer_on_success() {
    let env = Env::default();
    let authorizer = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    mock_auth(&env, &contract_id, &authorizer, "enforce_auth_for_test", ());

    let got = client.enforce_auth_for_test();
    assert_eq!(got, authorizer);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_enforce_auth_panics_without_auth() {
    let env = Env::default();
    let authorizer = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    // No `mock_auths` provided -> authorizer.require_auth() must fail.
    client.enforce_auth_for_test();
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_enforce_auth_panics_with_wrong_address_auth() {
    let env = Env::default();
    let authorizer = Address::generate(&env);
    let wrong_address = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    // Provide auth for the wrong address -> must still fail because authorizer is different.
    mock_auth(&env, &contract_id, &wrong_address, "enforce_auth_for_test", ());
    client.enforce_auth_for_test();
}

// ============================================
// require_auth
// ============================================

#[test]
fn test_require_auth_succeeds_when_authorizer_auths() {
    let env = Env::default();
    let authorizer = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    mock_auth(&env, &contract_id, &authorizer, "require_auth_for_test", ());

    client.require_auth_for_test();
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_require_auth_panics_without_auth() {
    let env = Env::default();
    let authorizer = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    // No `mock_auths` provided -> authorizer.require_auth() must fail.
    client.require_auth_for_test();
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_require_auth_panics_with_wrong_address_auth() {
    let env = Env::default();
    let authorizer = Address::generate(&env);
    let wrong_address = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    // Provide auth for the wrong address -> must still fail because authorizer is different.
    mock_auth(&env, &contract_id, &wrong_address, "require_auth_for_test", ());
    client.require_auth_for_test();
}

// ============================================
// behavior: authorizer changes
// ============================================

#[test]
fn test_enforce_auth_uses_current_authorizer_after_change() {
    let env = Env::default();
    let old_authorizer = Address::generate(&env);
    let new_authorizer = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&old_authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    // Update authorizer to `new_authorizer`.
    client.set_authorizer(&new_authorizer);

    // New authorizer can call, and enforce_auth returns the current authorizer.
    mock_auth(&env, &contract_id, &new_authorizer, "require_auth_for_test", ());
    client.require_auth_for_test();

    mock_auth(&env, &contract_id, &new_authorizer, "enforce_auth_for_test", ());
    let got = client.enforce_auth_for_test();
    assert_eq!(got, new_authorizer);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_require_auth_fails_with_stale_auth_after_authorizer_change() {
    let env = Env::default();
    let old_authorizer = Address::generate(&env);
    let new_authorizer = Address::generate(&env);

    let contract_id = env.register(AuthTestContract, (&old_authorizer,));
    let client = AuthTestContractClient::new(&env, &contract_id);

    // Change to a new authorizer, but only provide auth for the old one.
    client.set_authorizer(&new_authorizer);
    mock_auth(&env, &contract_id, &old_authorizer, "require_auth_for_test", ());

    // Must fail because current authorizer is now `new_authorizer`.
    client.require_auth_for_test();
}
