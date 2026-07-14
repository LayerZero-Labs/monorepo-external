extern crate std;

use crate::{
    auth::Auth,
    errors::RbacError,
    rbac::{
        ensure_role, grant_role_no_auth, remove_role_admin_no_auth, revoke_role_no_auth, RbacStorage, RoleAdminChanged,
        RoleBasedAccessControl, RoleGranted, RoleRevoked, MAX_ROLES,
    },
    testing_utils::{assert_eq_event, assert_eq_events},
    tests::test_helper::mock_auth,
};
use soroban_sdk::{contract, contractimpl, testutils::Address as _, Address, Env, Symbol, Vec};

// ============================================
// Test Contract
// ============================================

#[contract]
pub struct RbacTestContract;

fn authorizer_key(env: &Env) -> Symbol {
    Symbol::new(env, "authorizer")
}

#[contractimpl]
impl RbacTestContract {
    /// Test-only helper to set the authorizer in instance storage.
    ///
    /// NOTE: This is intentionally *not* protected by auth, since it's only used in unit tests.
    pub fn set_authorizer_for_test(env: &Env, authorizer: Address) {
        env.storage().instance().set(&authorizer_key(env), &authorizer);
    }

    // ----------------------------
    // Public helper wrappers
    // ----------------------------

    pub fn rbac_ensure_role(env: &Env, role: Symbol, caller: Address) {
        ensure_role::<Self>(env, &role, &caller);
    }

    pub fn rbac_rm_role_admin_no_auth(env: &Env, role: Symbol) {
        remove_role_admin_no_auth(env, &role);
    }

    // ----------------------------
    // Raw storage setters (test-only)
    // ----------------------------

    pub fn raw_set_existing_roles(env: &Env, roles: Vec<Symbol>) {
        RbacStorage::set_existing_roles(env, &roles);
    }

    pub fn raw_set_role_accounts_count(env: &Env, role: Symbol, count: u32) {
        RbacStorage::set_role_accounts_count(env, &role, &count);
    }

    pub fn raw_set_role_account_to_index(env: &Env, role: Symbol, account: Address, index: u32) {
        RbacStorage::set_role_account_to_index(env, &role, &account, &index);
    }

    pub fn raw_set_role_index_to_account(env: &Env, role: Symbol, index: u32, account: Address) {
        RbacStorage::set_role_index_to_account(env, &role, index, &account);
    }
}

/// `Auth` implementation for the test contract - uses a stored address as the authorizer.
impl Auth for RbacTestContract {
    fn authorizer(env: &Env) -> Option<Address> {
        env.storage().instance().get(&authorizer_key(env))
    }
}

// Expose `RoleBasedAccessControl` default methods as Soroban entrypoints.
#[contractimpl(contracttrait)]
impl RoleBasedAccessControl for RbacTestContract {}

fn setup_contract() -> (Env, Address, Address, RbacTestContractClient<'static>) {
    let env = Env::default();
    let contract_id = env.register(RbacTestContract, ());
    let client = RbacTestContractClient::new(&env, &contract_id);

    let authorizer = Address::generate(&env);
    client.set_authorizer_for_test(&authorizer);

    (env, contract_id, authorizer, client)
}

// ============================================
// Views + basic errors
// ============================================

#[test]
fn views_default_and_index_out_of_bounds_error_code() {
    let (env, _contract_id, _authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE");
    let acct = Address::generate(&env);

    assert_eq!(client.get_existing_roles(), Vec::<Symbol>::new(&env));
    assert_eq!(client.get_role_admin(&role), None);
    assert_eq!(client.get_role_member_count(&role), 0);
    assert_eq!(client.has_role(&acct, &role), None);

    // Ensure-role should fail when the caller is unauthorized.
    let res = client.try_rbac_ensure_role(&role, &acct);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::Unauthorized.into());

    // Member lookup out of bounds should return IndexOutOfBounds.
    let res = client.try_get_role_member(&role, &0u32);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::IndexOutOfBounds.into());
}

// ============================================
// grant_role / grant_role_no_auth
// ============================================

#[test]
fn grant_role_authorizer_emits_event_and_enumerates() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE1");
    let acct = Address::generate(&env);

    mock_auth(&env, &contract_id, &authorizer, "grant_role", (acct.clone(), role.clone(), authorizer.clone()));
    client.grant_role(&acct, &role, &authorizer);

    assert_eq_event(
        &env,
        &contract_id,
        RoleGranted { role: role.clone(), account: acct.clone(), caller: authorizer.clone() },
    );

    assert_eq!(client.get_role_member_count(&role), 1);
    assert_eq!(client.has_role(&acct, &role), Some(0));
    assert_eq!(client.get_role_member(&role, &0), acct.clone());

    let roles = client.get_existing_roles();
    assert_eq!(roles.len(), 1);
    assert_eq!(roles.get(0).unwrap(), role);

    // ensure_role succeeds for a held role.
    client.rbac_ensure_role(&Symbol::new(&env, "ROLE1"), &acct);
}

#[test]
fn authorizer_can_revoke_role() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE_AUTHZ_REVOKE");
    let user = Address::generate(&env);

    // Step 1: authorizer grants role to user.
    mock_auth(&env, &contract_id, &authorizer, "grant_role", (user.clone(), role.clone(), authorizer.clone()));
    client.grant_role(&user, &role, &authorizer);
    assert_eq_event(
        &env,
        &contract_id,
        RoleGranted { role: role.clone(), account: user.clone(), caller: authorizer.clone() },
    );
    assert_eq!(client.has_role(&user, &role), Some(0));
    assert_eq!(client.get_role_member_count(&role), 1);

    // Step 2: authorizer revokes role from user.
    mock_auth(&env, &contract_id, &authorizer, "revoke_role", (user.clone(), role.clone(), authorizer.clone()));
    client.revoke_role(&user, &role, &authorizer);
    assert_eq_event(&env, &contract_id, RoleRevoked { role: role.clone(), account: user.clone(), caller: authorizer });
    assert_eq!(client.has_role(&user, &role), None);
    assert_eq!(client.get_role_member_count(&role), 0);
}

#[test]
fn grant_role_no_auth_is_idempotent_and_emits_once() {
    let (env, contract_id, _authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE2");
    let acct = Address::generate(&env);
    let caller = Address::generate(&env);

    env.as_contract(&contract_id, || {
        grant_role_no_auth(&env, &acct, &role, &caller);
        // Second call should hit the early-return branch and emit no event.
        grant_role_no_auth(&env, &acct, &role, &caller);
    });

    // Only the first grant should emit.
    assert_eq_event(&env, &contract_id, RoleGranted { role: role.clone(), account: acct.clone(), caller });

    assert_eq!(client.get_role_member_count(&role), 1);
    assert_eq!(client.has_role(&acct, &role), Some(0));
}

#[test]
fn grant_role_unauthorized_returns_error_code() {
    let (env, contract_id, _authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE3");
    let acct = Address::generate(&env);
    let caller = Address::generate(&env);

    // Provide auth so we reach the RBAC Unauthorized check (not Auth::InvalidAction).
    mock_auth(&env, &contract_id, &caller, "grant_role", (acct.clone(), role.clone(), caller.clone()));
    let res = client.try_grant_role(&acct, &role, &caller);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::Unauthorized.into());

    assert_eq!(client.get_role_member_count(&role), 0);
    assert_eq!(client.get_existing_roles(), Vec::<Symbol>::new(&env));
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn grant_role_requires_auth() {
    let (env, _contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE_AUTH");
    let acct = Address::generate(&env);

    // No mock_auth -> caller.require_auth() must fail.
    client.grant_role(&acct, &role, &authorizer);
}

// ============================================
// set_role_admin
// ============================================

#[test]
fn set_role_admin_emits_event_with_previous_admin_values() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE_ADMIN_TEST");
    let admin1 = Symbol::new(&env, "ADMIN1");
    let admin2 = Symbol::new(&env, "ADMIN2");

    mock_auth(&env, &contract_id, &authorizer, "set_role_admin", (role.clone(), admin1.clone()));
    client.set_role_admin(&role, &admin1);

    assert_eq_event(
        &env,
        &contract_id,
        RoleAdminChanged { role: role.clone(), previous_admin_role: None, new_admin_role: Some(admin1.clone()) },
    );
    assert_eq!(client.get_role_admin(&role), Some(admin1.clone()));

    mock_auth(&env, &contract_id, &authorizer, "set_role_admin", (role.clone(), admin2.clone()));
    client.set_role_admin(&role, &admin2);

    assert_eq_event(
        &env,
        &contract_id,
        RoleAdminChanged {
            role: role.clone(),
            previous_admin_role: Some(admin1),
            new_admin_role: Some(admin2.clone()),
        },
    );
    assert_eq!(client.get_role_admin(&role), Some(admin2));
}

#[test]
fn remove_role_admin_errors_and_success() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE_ADMIN_REMOVE");
    let admin = Symbol::new(&env, "ADMIN_REMOVE");

    // If no admin role is set, removing should fail with AdminRoleNotFound.
    mock_auth(&env, &contract_id, &authorizer, "remove_role_admin", (role.clone(),));
    let res = client.try_remove_role_admin(&role);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::AdminRoleNotFound.into());

    // Set admin role (requires authorizer auth).
    mock_auth(&env, &contract_id, &authorizer, "set_role_admin", (role.clone(), admin.clone()));
    client.set_role_admin(&role, &admin);
    assert_eq!(client.get_role_admin(&role), Some(admin));

    // Now removal should succeed and clear the admin role.
    mock_auth(&env, &contract_id, &authorizer, "remove_role_admin", (role.clone(),));
    client.remove_role_admin(&role);
    assert_eq!(client.get_role_admin(&role), None);

    // Removing again should fail with AdminRoleNotFound.
    mock_auth(&env, &contract_id, &authorizer, "remove_role_admin", (role.clone(),));
    let res = client.try_remove_role_admin(&role);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::AdminRoleNotFound.into());
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn set_role_admin_requires_auth() {
    let (env, _contract_id, _authorizer, client) = setup_contract();
    let role = Symbol::new(&env, "ROLE_ADMIN_AUTH");
    let admin = Symbol::new(&env, "ADMIN");

    // No mock_auth -> only_auth/authorizer.require_auth() must fail.
    client.set_role_admin(&role, &admin);
}

// ============================================
// Admin-role pathway + revoke + renounce
// ============================================

#[test]
fn admin_role_holder_can_grant_revoke_and_renounce_emits_events() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE4");
    let admin_role = Symbol::new(&env, "ADMIN_ROLE");
    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    // Authorizer sets admin role for `role`.
    mock_auth(&env, &contract_id, &authorizer, "set_role_admin", (role.clone(), admin_role.clone()));
    client.set_role_admin(&role, &admin_role);
    assert_eq_event(
        &env,
        &contract_id,
        RoleAdminChanged { role: role.clone(), previous_admin_role: None, new_admin_role: Some(admin_role.clone()) },
    );

    // Authorizer grants the admin role to `admin`.
    mock_auth(&env, &contract_id, &authorizer, "grant_role", (admin.clone(), admin_role.clone(), authorizer.clone()));
    client.grant_role(&admin, &admin_role, &authorizer);
    assert_eq_event(
        &env,
        &contract_id,
        RoleGranted { role: admin_role.clone(), account: admin.clone(), caller: authorizer.clone() },
    );
    assert_eq!(client.has_role(&admin, &admin_role), Some(0));
    assert_eq!(client.get_role_member_count(&admin_role), 1);

    // Admin grants `role` to `user` (admin-role pathway).
    mock_auth(&env, &contract_id, &admin, "grant_role", (user.clone(), role.clone(), admin.clone()));
    client.grant_role(&user, &role, &admin);
    assert_eq_event(
        &env,
        &contract_id,
        RoleGranted { role: role.clone(), account: user.clone(), caller: admin.clone() },
    );
    assert_eq!(client.has_role(&user, &role), Some(0));
    assert_eq!(client.get_role_member_count(&role), 1);

    // Admin revokes `role` from `user`.
    mock_auth(&env, &contract_id, &admin, "revoke_role", (user.clone(), role.clone(), admin.clone()));
    client.revoke_role(&user, &role, &admin);
    assert_eq_event(
        &env,
        &contract_id,
        RoleRevoked { role: role.clone(), account: user.clone(), caller: admin.clone() },
    );
    assert_eq!(client.has_role(&user, &role), None);
    assert_eq!(client.get_role_member_count(&role), 0);
    // Admin should still hold the admin role.
    assert_eq!(client.has_role(&admin, &admin_role), Some(0));

    // Admin grants again, then user renounces.
    mock_auth(&env, &contract_id, &admin, "grant_role", (user.clone(), role.clone(), admin.clone()));
    client.grant_role(&user, &role, &admin);
    assert_eq_event(&env, &contract_id, RoleGranted { role: role.clone(), account: user.clone(), caller: admin });
    assert_eq!(client.has_role(&user, &role), Some(0));

    mock_auth(&env, &contract_id, &user, "renounce_role", (role.clone(), user.clone()));
    client.renounce_role(&role, &user);
    assert_eq_event(&env, &contract_id, RoleRevoked { role, account: user.clone(), caller: user.clone() });
    assert_eq!(client.has_role(&user, &Symbol::new(&env, "ROLE4")), None);
    assert_eq!(client.get_role_member_count(&Symbol::new(&env, "ROLE4")), 0);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn revoke_role_requires_auth() {
    let (env, _contract_id, authorizer, client) = setup_contract();
    let role = Symbol::new(&env, "ROLE_REVOKE_AUTH");
    let acct = Address::generate(&env);

    // No mock_auth -> caller.require_auth() must fail.
    client.revoke_role(&acct, &role, &authorizer);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn renounce_role_requires_auth() {
    let (env, _contract_id, _authorizer, client) = setup_contract();
    let role = Symbol::new(&env, "ROLE_RENOUNCE_AUTH");
    let caller = Address::generate(&env);

    // No mock_auth -> caller.require_auth() must fail.
    client.renounce_role(&role, &caller);
}

// ============================================
// revoke_role_no_auth + enumeration branches
// ============================================

#[test]
fn swap_remove_updates_indices_and_existing_roles_removed_on_last_member() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE6");
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let caller = Address::generate(&env);

    // Single contract context emits 3 events and hits the swap-remove branch.
    env.as_contract(&contract_id, || {
        grant_role_no_auth(&env, &a1, &role, &caller);
        grant_role_no_auth(&env, &a2, &role, &caller);
        revoke_role_no_auth(&env, &a1, &role, &caller);
    });
    assert_eq_events(
        &env,
        &contract_id,
        &[
            &RoleGranted { role: role.clone(), account: a1.clone(), caller: caller.clone() },
            &RoleGranted { role: role.clone(), account: a2.clone(), caller: caller.clone() },
            &RoleRevoked { role: role.clone(), account: a1.clone(), caller: caller.clone() },
        ],
    );

    // After swap-remove, only a2 should remain at index 0.
    assert_eq!(client.get_role_member_count(&role), 1);
    assert_eq!(client.has_role(&a2, &role), Some(0));
    assert_eq!(client.has_role(&a1, &role), None);
    assert_eq!(client.get_role_member(&role, &0), a2.clone());
    assert_eq!(client.get_existing_roles().len(), 1);

    // Remove last remaining member; role should be removed from existing roles.
    mock_auth(&env, &contract_id, &authorizer, "revoke_role", (a2.clone(), role.clone(), authorizer.clone()));
    client.revoke_role(&a2, &role, &authorizer);
    assert_eq_event(&env, &contract_id, RoleRevoked { role: role.clone(), account: a2, caller: authorizer });
    assert_eq!(client.get_existing_roles(), Vec::<Symbol>::new(&env));
}

#[test]
fn revoke_last_member_of_two_no_swap_branch() {
    let (env, contract_id, _authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE_NO_SWAP");
    let a1 = Address::generate(&env);
    let a2 = Address::generate(&env);
    let caller = Address::generate(&env);

    // Emit 3 events in one contract context: grant a1, grant a2, revoke a2.
    // This hits the `to_remove_idx == last_idx` branch with `count > 1`.
    env.as_contract(&contract_id, || {
        grant_role_no_auth(&env, &a1, &role, &caller);
        grant_role_no_auth(&env, &a2, &role, &caller);
        revoke_role_no_auth(&env, &a2, &role, &caller);
    });

    assert_eq_events(
        &env,
        &contract_id,
        &[
            &RoleGranted { role: role.clone(), account: a1.clone(), caller: caller.clone() },
            &RoleGranted { role: role.clone(), account: a2.clone(), caller: caller.clone() },
            &RoleRevoked { role: role.clone(), account: a2.clone(), caller: caller.clone() },
        ],
    );

    assert_eq!(client.get_role_member_count(&role), 1);
    assert_eq!(client.has_role(&a1, &role), Some(0));
    assert_eq!(client.has_role(&a2, &role), None);
    assert_eq!(client.get_role_member(&role, &0), a1);
}

// This test intentionally constructs an *inconsistent* RBAC storage state where a role has
// a member but the role is missing from `ExistingRoles`.
//
// The implementation detects this corruption on last-member removal: `remove_from_role_enumeration`
// calls `existing.first_index_of(role).unwrap_or_panic(..., RoleNotFound)`, which returns
// `RbacError::RoleNotFound` to the caller (it does not silently skip the removal).
#[test]
fn removing_last_member_when_role_missing_from_existing_roles_returns_role_not_found() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE7");
    let acct = Address::generate(&env);

    // Create a consistent single-member role, but *do not* include it in ExistingRoles.
    client.raw_set_existing_roles(&Vec::<Symbol>::new(&env));
    client.raw_set_role_accounts_count(&role, &1);
    client.raw_set_role_account_to_index(&role, &acct, &0);
    client.raw_set_role_index_to_account(&role, &0, &acct);

    // Revoking should fail with RoleNotFound because the role is missing from ExistingRoles.
    mock_auth(&env, &contract_id, &authorizer, "revoke_role", (acct.clone(), role.clone(), authorizer.clone()));
    let res = client.try_revoke_role(&acct, &role, &authorizer);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::RoleNotFound.into());
}

// ============================================
// Remaining error codes: RoleIsEmpty, MaxRolesExceeded
// ============================================

#[test]
fn role_is_empty_error_code() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE8");
    let acct = Address::generate(&env);

    // Force: account appears to hold role (mapping exists), but count is 0 -> RoleIsEmpty.
    client.raw_set_role_account_to_index(&role, &acct, &0);

    mock_auth(&env, &contract_id, &authorizer, "revoke_role", (acct.clone(), role.clone(), authorizer.clone()));
    let res = client.try_revoke_role(&acct, &role, &authorizer);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::RoleIsEmpty.into());
}

#[test]
fn revoke_role_entrypoint_missing_role_returns_error_code() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE9");
    let acct = Address::generate(&env);

    // Provide auth so we reach the RoleNotHeld error (not Auth::InvalidAction).
    mock_auth(&env, &contract_id, &authorizer, "revoke_role", (acct.clone(), role.clone(), authorizer.clone()));
    let res = client.try_revoke_role(&acct, &role, &authorizer);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::RoleNotHeld.into());
}

#[test]
fn revoke_role_entrypoint_unauthorized_returns_error_code() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let role = Symbol::new(&env, "ROLE10");
    let acct = Address::generate(&env);
    let caller = Address::generate(&env);

    // Role has an admin role, but caller has neither admin role nor is authorizer -> Unauthorized.
    let admin_role = Symbol::new(&env, "ADMIN_X");
    mock_auth(&env, &contract_id, &authorizer, "set_role_admin", (role.clone(), admin_role.clone()));
    client.set_role_admin(&role, &admin_role);

    mock_auth(&env, &contract_id, &caller, "revoke_role", (acct.clone(), role.clone(), caller.clone()));
    let res = client.try_revoke_role(&acct, &role, &caller);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::Unauthorized.into());
}

#[test]
fn max_roles_exceeded_error_code() {
    let (env, contract_id, authorizer, client) = setup_contract();

    let mut roles = Vec::<Symbol>::new(&env);
    for i in 0..MAX_ROLES {
        let s = std::format!("R{i}");
        roles.push_back(Symbol::new(&env, &s));
    }
    client.raw_set_existing_roles(&roles);

    let new_role = Symbol::new(&env, "NEW_ROLE");
    let acct = Address::generate(&env);

    mock_auth(&env, &contract_id, &authorizer, "grant_role", (acct.clone(), new_role.clone(), authorizer.clone()));
    let res = client.try_grant_role(&acct, &new_role, &authorizer);
    assert_eq!(res.err().unwrap().ok().unwrap(), RbacError::MaxRolesExceeded.into());
}
