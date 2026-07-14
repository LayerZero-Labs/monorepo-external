use crate::{
    auth::Auth,
    errors::OwnableError,
    ownable::{
        self, Ownable, OwnableInitializer, OwnableStorage, OwnershipRenounced, OwnershipTransferred,
        OwnershipTransferring,
    },
    testing_utils::assert_eq_event,
    tests::test_helper::mock_auth,
};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{storage::Temporary as _, Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    Address, Env, IntoVal,
};

#[contract]
pub struct Contract;

#[contractimpl]
impl Contract {
    pub fn __constructor(env: &Env, owner: &Address) {
        Self::init_owner(env, owner);
    }

    pub fn enforce_and_return_owner(env: &Env) -> Address {
        ownable::enforce_owner_auth::<Self>(env)
    }

    pub fn remove_owner(env: &Env) {
        OwnableStorage::remove_owner(env);
    }

    pub fn reinit_owner(env: &Env, owner: &Address) {
        Self::init_owner(env, owner);
    }
}

/// Auth implementation for the test contract - uses stored owner as authorizer.
#[contractimpl]
impl Auth for Contract {
    fn authorizer(env: &Env) -> Option<Address> {
        <Self as Ownable>::owner(env)
    }
}

#[contractimpl(contracttrait)]
impl Ownable for Contract {}
impl OwnableInitializer for Contract {}

// ============================================
// auth: Owner authentication tests
// ============================================

#[test]
fn auth_owner_can_call() {
    let env = Env::default();
    let owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    mock_auth(&env, &contract, &owner, "enforce_and_return_owner", ());
    client.enforce_and_return_owner();
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn auth_non_owner_cannot_call() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Try to call without auth should fail
    client.enforce_and_return_owner();
}

// ============================================
// transfer: Single-step transfer ownership tests
// ============================================

#[test]
fn transfer_ownership_with_event() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    assert_eq!(client.owner(), Some(owner.clone()));

    mock_auth(&env, &contract, &owner, "transfer_ownership", (&new_owner,));
    client.transfer_ownership(&new_owner);

    assert_eq_event(&env, &contract, OwnershipTransferred { old_owner: owner, new_owner: new_owner.clone() });
    assert_eq!(client.owner(), Some(new_owner));
}

#[test]
fn transfer_ownership_to_same_owner() {
    let env = Env::default();
    let owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    assert_eq!(client.owner(), Some(owner.clone()));

    mock_auth(&env, &contract, &owner, "transfer_ownership", (&owner,));
    client.transfer_ownership(&owner);

    // Should still emit event and update (even if same owner)
    assert_eq_event(&env, &contract, OwnershipTransferred { old_owner: owner.clone(), new_owner: owner.clone() });
    assert_eq!(client.owner(), Some(owner));
}

#[test]
fn transfer_after_renounce_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Renounce ownership
    mock_auth(&env, &contract, &owner, "renounce_ownership", ());
    client.renounce_ownership();

    // Try to transfer after renounce - should fail with AuthorizerNotFound
    mock_auth(&env, &contract, &owner, "transfer_ownership", (&new_owner,));
    let result = client.try_transfer_ownership(&new_owner);
    assert_eq!(result.err().unwrap().ok().unwrap(), OwnableError::OwnerNotSet.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn transfer_ownership_non_owner_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let non_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Non-owner tries to transfer with their own auth - should fail
    mock_auth(&env, &contract, &non_owner, "transfer_ownership", (&non_owner,));
    client.transfer_ownership(&non_owner);
}

#[test]
#[should_panic(expected = "Error(Contract, #1036)")] // TransferInProgress
fn transfer_ownership_blocked_during_2step() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let another_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    // Initiate 2-step transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);

    // Try single-step transfer - should fail
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&another_owner,).into_val(&env),
            fn_name: "transfer_ownership",
            sub_invokes: &[],
        },
    }]);
    client.transfer_ownership(&another_owner);
}

// ============================================
// transfer_2step: Two-step transfer ownership tests
// ============================================

#[test]
fn begin_ownership_transfer_initiate_and_accept() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    assert_eq!(client.owner(), Some(owner.clone()));
    assert_eq!(client.pending_owner(), None);

    // Step 1: Initiate transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);

    assert_eq_event(
        &env,
        &contract,
        OwnershipTransferring { old_owner: owner.clone(), new_owner: new_owner.clone(), ttl },
    );
    assert_eq!(client.owner(), Some(owner.clone())); // Still old owner
    assert_eq!(client.pending_owner(), Some(new_owner.clone()));

    // Step 2: Accept transfer
    env.mock_auths(&[MockAuth {
        address: &new_owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: ().into_val(&env),
            fn_name: "accept_ownership",
            sub_invokes: &[],
        },
    }]);
    client.accept_ownership();

    assert_eq_event(&env, &contract, OwnershipTransferred { old_owner: owner, new_owner: new_owner.clone() });
    assert_eq!(client.owner(), Some(new_owner)); // Now new owner
    assert_eq!(client.pending_owner(), None);
}

#[test]
fn pending_owner_expires_after_ttl() {
    let env = Env::default();
    env.ledger().set_sequence_number(1_000);

    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 10u32;

    // Initiate transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);
    assert_eq!(client.pending_owner(), Some(new_owner.clone()));

    // Advance ledger beyond the actual storage TTL window; temporary pending owner entry should expire.
    // Note: `extend_ttl` cannot reduce TTL, so the effective TTL can be >= the requested `ttl`.
    let (ttl_before, seq_before) = env.as_contract(&contract, || {
        (env.storage().temporary().get_ttl(&OwnableStorage::PendingOwner), env.ledger().sequence())
    });
    assert!(ttl_before >= ttl, "pending owner TTL must be at least requested ttl");

    let live_until = seq_before + ttl_before;
    env.ledger().set_sequence_number(live_until + 1);

    assert_eq!(client.pending_owner(), None);

    // Accept should now fail with NoPendingTransfer (expired).
    let res = client.try_accept_ownership();
    assert_eq!(res.err().unwrap().ok().unwrap(), OwnableError::NoPendingTransfer.into());
}

#[test]
fn begin_ownership_transfer_cancel() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    // Initiate transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);

    assert_eq!(client.pending_owner(), Some(new_owner.clone()));

    // Cancel transfer (ttl = 0)
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, 0u32).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &0u32);

    // No event emitted on cancel (matching OpenZeppelin behavior)
    assert_eq!(client.owner(), Some(owner)); // Still old owner
    assert_eq!(client.pending_owner(), None);
}

#[test]
fn begin_ownership_transfer_with_max_ttl() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Use max TTL
    let max_ttl = env.storage().max_ttl();
    // Initiate transfer with max TTL
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, max_ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &max_ttl);

    assert_eq!(client.pending_owner(), Some(new_owner.clone()));

    // Get the actual TTL of the pending_owner entry
    let actual_ttl = env.as_contract(&contract, || env.storage().temporary().get_ttl(&OwnableStorage::PendingOwner));

    // The actual TTL should be at least the requested TTL
    // To see the value, temporarily use: assert_eq!(actual_ttl, 0);
    assert!(actual_ttl == max_ttl, "TTL should be max_ttl");
}

#[test]
#[should_panic(expected = "Error(Contract, #1033)")] // NoPendingTransfer
fn begin_ownership_transfer_cancel_no_pending_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Try to cancel when no transfer is pending
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, 0u32).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &0u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #1031)")] // InvalidPendingOwner
fn begin_ownership_transfer_cancel_wrong_address_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let wrong_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    // Initiate transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);

    // Try to cancel with wrong address
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&wrong_owner, 0u32).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&wrong_owner, &0u32);
}

#[test]
#[should_panic(expected = "Error(Contract, #1032)")] // InvalidTtl
fn begin_ownership_transfer_invalid_ttl_exceeds_max_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // TTL that would exceed max_live_until_ledger
    let ttl = env.storage().max_ttl() + 1;

    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);

    client.begin_ownership_transfer(&new_owner, &ttl);
}

#[test]
#[should_panic(expected = "Error(Contract, #1033)")] // NoPendingTransfer
fn accept_ownership_no_pending_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Try to accept when no transfer is pending
    env.mock_auths(&[MockAuth {
        address: &new_owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: ().into_val(&env),
            fn_name: "accept_ownership",
            sub_invokes: &[],
        },
    }]);
    client.accept_ownership();
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn accept_ownership_wrong_address_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let wrong_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    // Initiate transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);

    // Try to accept with wrong address
    env.mock_auths(&[MockAuth {
        address: &wrong_owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: ().into_val(&env),
            fn_name: "accept_ownership",
            sub_invokes: &[],
        },
    }]);
    client.accept_ownership();
}

#[test]
fn begin_ownership_transfer_override_pending() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner1 = Address::generate(&env);
    let new_owner2 = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    // Initiate first transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner1, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner1, &ttl);

    assert_eq!(client.pending_owner(), Some(new_owner1.clone()));

    // Override with second transfer (allowed - replaces pending)
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner2, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner2, &ttl);

    assert_eq!(client.pending_owner(), Some(new_owner2.clone()));

    // new_owner2 can accept
    env.mock_auths(&[MockAuth {
        address: &new_owner2,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: ().into_val(&env),
            fn_name: "accept_ownership",
            sub_invokes: &[],
        },
    }]);
    client.accept_ownership();

    assert_eq!(client.owner(), Some(new_owner2));
}

// ============================================
// renounce: Renounce ownership tests
// ============================================

#[test]
fn renounce_ownership_with_event() {
    let env = Env::default();
    let owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    assert_eq!(client.owner(), Some(owner.clone()));

    mock_auth(&env, &contract, &owner, "renounce_ownership", ());
    client.renounce_ownership();

    assert_eq_event(&env, &contract, OwnershipRenounced { old_owner: owner });
    assert_eq!(client.owner(), None);
}

#[test]
fn renounce_after_renounce_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Renounce ownership
    mock_auth(&env, &contract, &owner, "renounce_ownership", ());
    client.renounce_ownership();

    // Try to renounce again - should fail with AuthorizerNotFound
    mock_auth(&env, &contract, &owner, "renounce_ownership", ());
    let result = client.try_renounce_ownership();
    assert_eq!(result.err().unwrap().ok().unwrap(), OwnableError::OwnerNotSet.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn renounce_ownership_non_owner_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let non_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Non-owner tries to renounce with their own auth - should fail
    mock_auth(&env, &contract, &non_owner, "renounce_ownership", ());
    client.renounce_ownership();
}

#[test]
#[should_panic(expected = "Error(Contract, #1036)")] // TransferInProgress
fn renounce_blocked_during_2step_transfer() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    // Initiate 2-step transfer
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);

    // Try to renounce - should fail
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: ().into_val(&env),
            fn_name: "renounce_ownership",
            sub_invokes: &[],
        },
    }]);
    client.renounce_ownership();
}

// ============================================
// chain: Ownership chain tests
// ============================================

#[test]
fn chain_new_owner_can_transfer() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let third_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    // Transfer to new_owner
    mock_auth(&env, &contract, &owner, "transfer_ownership", (&new_owner,));
    client.transfer_ownership(&new_owner);

    // Verify old owner cannot call anymore
    mock_auth(&env, &contract, &owner, "enforce_and_return_owner", ());
    let result = client.try_enforce_and_return_owner();
    assert!(result.is_err(), "old owner should not be able to call after transfer");

    // new_owner can now transfer to third_owner
    mock_auth(&env, &contract, &new_owner, "transfer_ownership", (&third_owner,));
    client.transfer_ownership(&third_owner);

    assert_eq!(client.owner(), Some(third_owner));
}

#[test]
fn chain_new_owner_can_transfer_2step() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let third_owner = Address::generate(&env);

    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let ttl = 1000u32;

    // 2-step transfer to new_owner
    env.mock_auths(&[MockAuth {
        address: &owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&new_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&new_owner, &ttl);

    env.mock_auths(&[MockAuth {
        address: &new_owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: ().into_val(&env),
            fn_name: "accept_ownership",
            sub_invokes: &[],
        },
    }]);
    client.accept_ownership();

    // new_owner can now do another 2-step transfer
    env.mock_auths(&[MockAuth {
        address: &new_owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: (&third_owner, ttl).into_val(&env),
            fn_name: "begin_ownership_transfer",
            sub_invokes: &[],
        },
    }]);
    client.begin_ownership_transfer(&third_owner, &ttl);

    env.mock_auths(&[MockAuth {
        address: &third_owner,
        invoke: &MockAuthInvoke {
            contract: &contract,
            args: ().into_val(&env),
            fn_name: "accept_ownership",
            sub_invokes: &[],
        },
    }]);
    client.accept_ownership();

    assert_eq!(client.owner(), Some(third_owner));
}

// ============================================
// init: DefaultOwnable::init_owner tests
// ============================================

#[test]
fn reinit_owner_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let new_owner = Address::generate(&env);
    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    let result = client.try_reinit_owner(&new_owner);
    assert_eq!(result.err().unwrap().ok().unwrap(), OwnableError::OwnerAlreadySet.into());
}

// ============================================
// enforce: enforce_owner_auth tests
// ============================================

#[test]
fn enforce_owner_auth_returns_owner() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    mock_auth(&env, &contract, &owner, "enforce_and_return_owner", ());

    let returned_owner = client.enforce_and_return_owner();
    assert_eq!(returned_owner, owner);
}

#[test]
fn enforce_owner_auth_no_owner_set_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    client.remove_owner();

    // Even with auth, enforce_owner_auth must fail because no owner is set in storage.
    mock_auth(&env, &contract, &owner, "enforce_and_return_owner", ());
    let result = client.try_enforce_and_return_owner();
    assert_eq!(result.err().unwrap().ok().unwrap(), OwnableError::OwnerNotSet.into());
}

#[test]
fn require_owner_auth_no_owner_set_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    client.remove_owner();

    let result = client.try_enforce_and_return_owner();
    assert_eq!(result.err().unwrap().ok().unwrap(), OwnableError::OwnerNotSet.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn enforce_owner_auth_wrong_address_fails() {
    let env = Env::default();
    let owner = Address::generate(&env);
    let wrong_address = Address::generate(&env);
    let contract = env.register(Contract, (&owner,));
    let client = ContractClient::new(&env, &contract);

    mock_auth(&env, &contract, &wrong_address, "enforce_and_return_owner", ());

    client.enforce_and_return_owner();
}
