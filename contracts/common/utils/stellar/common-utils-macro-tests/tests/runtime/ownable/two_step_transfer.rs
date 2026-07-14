// Runtime tests: 2-step ownership transfer behavior (`begin_ownership_transfer` + `accept_ownership`).
//
// Ownable supports a safer two-step flow using temporary storage with TTL. These tests ensure
// the macro-exported contract entrypoints are wired and behave correctly at runtime.

use super::{TestContract, TestContractClient};
use soroban_sdk::{
    testutils::{storage::Temporary as _, Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal,
};
use utils::errors::OwnableError;
use utils::ownable::{OwnableStorage, OwnershipTransferred, OwnershipTransferring};
use utils::testing_utils::assert_eq_event;

#[test]
fn propose_requires_owner_auth() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    client.init(&owner);

    // No auth provided -> should fail at require_auth.
    let ttl = 10u32;
    let res = client.try_begin_ownership_transfer(&new_owner, &ttl);
    assert_eq!(
        res.err().unwrap().ok().unwrap(),
        soroban_sdk::Error::from_type_and_code(
            soroban_sdk::xdr::ScErrorType::Context,
            soroban_sdk::xdr::ScErrorCode::InvalidAction
        )
    );
}

#[test]
fn propose_rejects_invalid_ttl() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    client.init(&owner);

    let ttl = env.storage().max_ttl().saturating_add(1);
    let res = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "begin_ownership_transfer",
                args: (&new_owner, &ttl).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_begin_ownership_transfer(&new_owner, &ttl);
    assert_eq!(res.err().unwrap().ok().unwrap(), OwnableError::InvalidTtl.into());
    assert_eq!(client.pending_owner(), None);
}

#[test]
fn propose_and_accept_transfers_ownership() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    client.init(&owner);

    // Propose transfer (owner auth required).
    let ttl = 10u32;
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "begin_ownership_transfer",
                args: (&new_owner, &ttl).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .begin_ownership_transfer(&new_owner, &ttl);

    assert_eq_event(
        &env,
        &contract_id,
        OwnershipTransferring { old_owner: owner.clone(), new_owner: new_owner.clone(), ttl },
    );
    assert_eq!(client.pending_owner(), Some(new_owner.clone()));
    assert_eq!(client.owner(), Some(owner.clone()));

    // Accept transfer (pending owner auth required).
    client
        .mock_auths(&[MockAuth {
            address: &new_owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "accept_ownership",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .accept_ownership();

    assert_eq_event(
        &env,
        &contract_id,
        OwnershipTransferred { old_owner: owner.clone(), new_owner: new_owner.clone() },
    );
    assert_eq!(client.pending_owner(), None);
    assert_eq!(client.owner(), Some(new_owner));
}

#[test]
fn pending_transfer_blocks_single_step_transfer_and_renounce() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let pending = Address::generate(&env);
    let other = Address::generate(&env);
    client.init(&owner);

    let ttl = 10u32;
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "begin_ownership_transfer",
                args: (&pending, &ttl).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .begin_ownership_transfer(&pending, &ttl);

    // With owner auth, immediate transfer should fail due to TransferInProgress.
    let transfer = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "transfer_ownership",
                args: (&other,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_transfer_ownership(&other);
    assert_eq!(transfer.err().unwrap().ok().unwrap(), OwnableError::TransferInProgress.into());

    // With owner auth, renounce should also fail due to TransferInProgress.
    let renounce = client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "renounce_ownership",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_renounce_ownership();
    assert_eq!(renounce.err().unwrap().ok().unwrap(), OwnableError::TransferInProgress.into());
}

#[test]
fn pending_transfer_expires_and_cannot_be_accepted() {
    let env = Env::default();
    let contract_id = env.register(TestContract, ());
    let client = TestContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let pending = Address::generate(&env);
    client.init(&owner);

    let ttl = 1u32;
    client
        .mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "begin_ownership_transfer",
                args: (&pending, &ttl).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .begin_ownership_transfer(&pending, &ttl);

    assert_eq!(client.pending_owner(), Some(pending.clone()));

    // Advance beyond the pending owner's *actual* temporary TTL so it expires.
    // Note: `extend_ttl` does not shrink TTL, so `ttl` is not guaranteed to be the TTL.
    let (pending_ttl, seq) = env.as_contract(&contract_id, || {
        (env.storage().temporary().get_ttl(&OwnableStorage::PendingOwner), env.ledger().sequence())
    });
    let live_until = seq + pending_ttl;
    env.ledger().set_sequence_number(live_until + 1);

    assert_eq!(client.pending_owner(), None);

    // Even with pending-owner auth, accept should fail because the transfer expired.
    let res = client
        .mock_auths(&[MockAuth {
            address: &pending,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "accept_ownership",
                args: ().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_accept_ownership();
    assert_eq!(res.err().unwrap().ok().unwrap(), OwnableError::NoPendingTransfer.into());

    // Owner should remain unchanged.
    assert_eq!(client.owner(), Some(owner));
}
