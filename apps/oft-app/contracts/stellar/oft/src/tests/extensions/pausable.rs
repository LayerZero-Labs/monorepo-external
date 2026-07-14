extern crate std;

use crate::extensions::pausable::{OFTPausable, OFTPausableError, OFTPausableInternal};
use crate::extensions::pausable::{PAUSER_ROLE, UNPAUSER_ROLE};
use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
use utils::rbac::{grant_role_no_auth, RoleBasedAccessControl};
use utils::auth::Auth;

// ============================================================================
// Test Contract
// ============================================================================

#[contract]
struct PausableTestContract;

impl Auth for PausableTestContract {
    fn authorizer(env: &Env) -> Option<Address> {
        Some(env.current_contract_address())
    }
}

impl OFTPausableInternal for PausableTestContract {}

#[contractimpl(contracttrait)]
impl OFTPausable for PausableTestContract {}

#[contractimpl(contracttrait)]
impl RoleBasedAccessControl for PausableTestContract {}

#[contractimpl]
impl PausableTestContract {
    /// Test-only: grants PAUSER_ROLE and UNPAUSER_ROLE to the contract.
    pub fn init_roles(env: Env) {
        let contract_id = env.current_contract_address();
        grant_role_no_auth(&env, &contract_id, &Symbol::new(&env, PAUSER_ROLE), &contract_id);
        grant_role_no_auth(&env, &contract_id, &Symbol::new(&env, UNPAUSER_ROLE), &contract_id);
    }

    pub fn assert_not_paused(env: Env) {
        <Self as OFTPausableInternal>::__assert_not_paused(&env)
    }
}

// ============================================================================
// Test Setup
// ============================================================================

struct TestSetup {
    client: PausableTestContractClient<'static>,
    contract_id: Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

    let contract_id = env.register(PausableTestContract, ());
    let client = PausableTestContractClient::new(&env, &contract_id);
    client.init_roles();
    TestSetup { client, contract_id }
}

// ============================================================================
// Initial State Tests
// ============================================================================

#[test]
fn test_initial_state_is_not_paused() {
    let TestSetup { client, .. } = setup();

    assert!(!client.is_paused());
}

// ============================================================================
// Pause/Unpause Tests
// ============================================================================

#[test]
fn test_pause_sets_paused() {
    let TestSetup { client, contract_id, .. } = setup();

    client.pause(&contract_id);
    assert!(client.is_paused());
}

#[test]
fn test_unpause_after_pausing() {
    let TestSetup { client, contract_id, .. } = setup();

    client.pause(&contract_id);
    assert!(client.is_paused());

    client.unpause(&contract_id);
    assert!(!client.is_paused());
}

#[test]
fn test_unpause_unchanged_when_unpaused() {
    let TestSetup { client, contract_id, .. } = setup();

    // Initially not paused, unpause should fail
    let res = client.try_unpause(&contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTPausableError::PauseStatusUnchanged.into());
}

#[test]
fn test_pause_unchanged_when_paused() {
    let TestSetup { client, contract_id, .. } = setup();

    client.pause(&contract_id);

    // Already paused, pause again should fail
    let res = client.try_pause(&contract_id);
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTPausableError::PauseStatusUnchanged.into());
}

// ============================================================================
// Assert Not Paused Tests
// ============================================================================

#[test]
fn test_assert_not_paused_succeeds_when_not_paused() {
    let TestSetup { client, .. } = setup();

    // Should not panic when not paused
    client.assert_not_paused();
}

#[test]
fn test_assert_not_paused_fails_when_paused() {
    let TestSetup { client, contract_id, .. } = setup();

    client.pause(&contract_id);

    let res = client.try_assert_not_paused();
    assert_eq!(res.err().unwrap().ok().unwrap(), OFTPausableError::Paused.into());
}

// ============================================================================
// Toggle Tests
// ============================================================================

#[test]
fn test_pause_unpause_toggle_multiple_times() {
    let TestSetup { client, contract_id, .. } = setup();

    // Toggle multiple times
    for _ in 0..3 {
        assert!(!client.is_paused());
        client.pause(&contract_id);
        assert!(client.is_paused());
        client.unpause(&contract_id);
    }
    assert!(!client.is_paused());
}
