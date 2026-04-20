// Runtime tests: Ownership transfer and renounce behavior.
//
// Tests covered:
// - `transfer_ownership` requires current owner authorization.
// - `renounce_ownership` clears owner and blocks further operations.

use super::{TestContract, TestContractClient};
use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    xdr::{ScErrorCode, ScErrorType},
    Address, Env, Error, IntoVal,
};
use utils::errors::{AuthError, OwnableError};
use utils::ownable::{OwnershipRenounced, OwnershipTransferred};
use utils::testing_utils::assert_eq_event;

#[test]
fn transfer_requires_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let third_owner = Address::generate(&env);

    client.init(&owner);

    // Unauthorized transfer should fail
    let unauthorized = client.try_transfer_ownership(&new_owner);
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Authorized transfer should succeed
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "transfer_ownership",
                args: (&new_owner,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .transfer_ownership(&new_owner);

    assert_eq_event(
        &env,
        &contract_id,
        OwnershipTransferred { old_owner: owner.clone(), new_owner: new_owner.clone() },
    );

    // Owner should be updated
    assert_eq!(client.owner(), Some(new_owner.clone()));

    // Old owner should no longer be able to transfer ownership (even with auth).
    let old_owner_transfer = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "transfer_ownership",
                args: (&third_owner,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_transfer_ownership(&third_owner);
    assert_eq!(
        old_owner_transfer.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // New owner can transfer again.
    client
        .mock_auths(&[MockAuth {
            address: &new_owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "transfer_ownership",
                args: (&third_owner,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .transfer_ownership(&third_owner);

    assert_eq_event(
        &env,
        &contract_id,
        OwnershipTransferred { old_owner: new_owner.clone(), new_owner: third_owner.clone() },
    );
    assert_eq!(client.owner(), Some(third_owner));
}

#[test]
fn renounce_clears_owner() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let not_owner = Address::generate(&env);
    client.init(&owner);
    assert_eq!(client.owner(), Some(owner.clone()));

    // Unauthorized renounce should fail
    let unauthorized = client.try_renounce_ownership();
    assert_eq!(
        unauthorized.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Wrong-address auth should also fail (auth must be provided by the current owner).
    let wrong_auth = client
        .mock_auths(&[MockAuth {
            address: &not_owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "renounce_ownership",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_renounce_ownership();
    assert_eq!(
        wrong_auth.unwrap_err().unwrap(),
        Error::from_type_and_code(ScErrorType::Context, ScErrorCode::InvalidAction)
    );

    // Renounce ownership (authorized by current owner)
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "renounce_ownership",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .renounce_ownership();

    assert_eq_event(&env, &contract_id, OwnershipRenounced { old_owner: owner.clone() });

    // Owner should be None after renouncing
    assert_eq!(client.owner(), None);

    // Renouncing again should fail because there is no owner anymore.
    assert_eq!(client.try_renounce_ownership().unwrap_err().unwrap(), OwnableError::OwnerNotSet.into());

    // All owner-protected operations should now fail
    let guarded_result = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "guarded",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_guarded();
    assert_eq!(guarded_result.unwrap_err().unwrap(), AuthError::AuthorizerNotFound.into());

    assert_eq!(
        client.try_transfer_ownership(&Address::generate(&env)).unwrap_err().unwrap(),
        OwnableError::OwnerNotSet.into()
    );
}
