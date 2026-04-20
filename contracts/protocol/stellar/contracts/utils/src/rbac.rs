//! Role-Based Access Control (RBAC) for Soroban contracts.
//!
//! Combines OpenZeppelin-style role management with the Auth pattern.
//! The authorizer (e.g. owner from Ownable, or contract from MultiSig) replaces Admin.

use crate::{self as utils, auth::Auth, errors::RbacError, option_ext::OptionExt};
use common_macros::{contract_trait, only_auth, storage};
use soroban_sdk::{assert_with_error, contractevent, Address, Env, Symbol, Vec};

// ===========================================================================
// Constants
// ===========================================================================

/// Maximum number of roles that can exist simultaneously.
pub const MAX_ROLES: u32 = 256;

/// Role representing the contract's authorizer.
pub const AUTHORIZER: &str = "AUTHORIZER";

// ===========================================================================
// Events
// ===========================================================================

/// Event emitted when a role is granted.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleGranted {
    #[topic]
    pub role: Symbol,
    #[topic]
    pub account: Address,
    pub caller: Address,
}

/// Event emitted when a role is revoked.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleRevoked {
    #[topic]
    pub role: Symbol,
    #[topic]
    pub account: Address,
    pub caller: Address,
}

/// Event emitted when a role admin is changed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleAdminChanged {
    #[topic]
    pub role: Symbol,
    pub previous_admin_role: Option<Symbol>,
    pub new_admin_role: Option<Symbol>,
}

// ===========================================================================
// Storage
// ===========================================================================

#[storage]
pub enum RbacStorage {
    /// All roles that have at least one member
    #[persistent(Vec<Symbol>)]
    #[default(Vec::new(env))]
    ExistingRoles,

    /// (role, index) -> Address
    #[persistent(Address)]
    RoleIndexToAccount { role: Symbol, index: u32 },

    /// (role, account) -> index
    #[persistent(u32)]
    RoleAccountToIndex { role: Symbol, account: Address },

    /// role -> count of accounts
    #[persistent(u32)]
    #[default(0)]
    RoleAccountsCount { role: Symbol },

    /// role -> admin role (who can grant/revoke this role). Key removed when no admin.
    #[persistent(Symbol)]
    RoleAdmin { role: Symbol },
}

// ===========================================================================
// Trait
// ===========================================================================

/// Trait for contracts with role-based access control.
///
/// Extends `Auth` — the authorizer replaces the traditional admin and can grant/revoke
/// any role. Each role can also have an admin role for hierarchical control.
#[contract_trait]
pub trait RoleBasedAccessControl: Auth {
    // ===========================================================================
    // State-changing
    // ===========================================================================

    /// Grants a role to an account. Caller must be owner or have the role's admin role.
    ///
    /// # Arguments
    /// * `account` - The account to grant the role to.
    /// * `role` - The role to grant.
    /// * `caller` - The account that is granting the role. Must be owner or have the role's admin role.
    fn grant_role(
        env: &soroban_sdk::Env,
        account: &soroban_sdk::Address,
        role: &soroban_sdk::Symbol,
        caller: &soroban_sdk::Address,
    ) {
        caller.require_auth();
        ensure_if_authorizer_or_role_admin::<Self>(env, role, caller);
        grant_role_no_auth(env, account, role, caller);
    }

    /// Revokes a role from an account. Caller must be owner or have the role's admin role.
    ///
    /// # Arguments
    /// * `account` - The account to revoke the role from.
    /// * `role` - The role to revoke.
    /// * `caller` - The account that is revoking the role. Must be owner or have the role's admin role.
    fn revoke_role(
        env: &soroban_sdk::Env,
        account: &soroban_sdk::Address,
        role: &soroban_sdk::Symbol,
        caller: &soroban_sdk::Address,
    ) {
        caller.require_auth();
        ensure_if_authorizer_or_role_admin::<Self>(env, role, caller);
        revoke_role_no_auth(env, account, role, caller);
    }

    /// Allows an account to renounce a role assigned to itself.
    /// Users can only renounce roles for their own account.
    ///
    /// # Arguments
    /// * `role` - The role to renounce.
    /// * `caller` - The account that is renouncing the role. Must be the account itself.
    fn renounce_role(env: &soroban_sdk::Env, role: &soroban_sdk::Symbol, caller: &soroban_sdk::Address) {
        caller.require_auth();
        revoke_role_no_auth(env, caller, role, caller);
    }

    /// Sets `admin_role` as the admin role of `role`. Caller must be the authorizer.
    ///
    /// # Arguments
    /// * `role` - The role to set the admin for.
    /// * `admin_role` - The admin role to set for the role.
    ///
    /// # Notes
    ///
    /// The admin role can be any `Symbol`, including one with no members. If the admin
    /// role has no members, only the authorizer can grant/revoke the role.
    #[only_auth]
    fn set_role_admin(env: &soroban_sdk::Env, role: &soroban_sdk::Symbol, admin_role: &soroban_sdk::Symbol) {
        set_role_admin_no_auth(env, role, admin_role);
    }

    /// Removes the admin role for a specified role. Caller must be the authorizer.
    ///
    /// # Arguments
    /// * `role` - The role to remove the admin for.
    ///
    /// # Errors
    /// * `RbacError::AdminRoleNotFound` - If no admin role is set for the role.
    #[only_auth]
    fn remove_role_admin(env: &soroban_sdk::Env, role: &soroban_sdk::Symbol) {
        remove_role_admin_no_auth(env, role);
    }

    // ===========================================================================
    // View functions
    // ===========================================================================

    /// Returns `Some(index)` if the account has the specified role, where `index`
    /// is the index of the account in the role. Returns `None` if not.
    ///
    /// # Arguments
    /// * `account` - The account to check the role for.
    /// * `role` - The role to check the account for.
    fn has_role(env: &soroban_sdk::Env, account: &soroban_sdk::Address, role: &soroban_sdk::Symbol) -> Option<u32> {
        RbacStorage::role_account_to_index(env, role, account)
    }

    /// Returns the admin role for a specific role, or None if not set.
    ///
    /// # Arguments
    /// * `role` - The role to get the admin for.
    fn get_role_admin(env: &soroban_sdk::Env, role: &soroban_sdk::Symbol) -> Option<soroban_sdk::Symbol> {
        RbacStorage::role_admin(env, role)
    }

    /// Returns the number of accounts that have the specified role.
    ///
    /// # Arguments
    /// * `role` - The role to get the member count for.
    fn get_role_member_count(env: &soroban_sdk::Env, role: &soroban_sdk::Symbol) -> u32 {
        RbacStorage::role_accounts_count(env, role)
    }

    /// Returns the account at the specified index for a given role.
    ///
    /// # Arguments
    /// * `role` - The role to get the member for.
    /// * `index` - The index of the member to get.
    ///
    /// # Errors
    /// * `RbacError::IndexOutOfBounds` if the index is out of bounds.
    fn get_role_member(env: &soroban_sdk::Env, role: &soroban_sdk::Symbol, index: u32) -> soroban_sdk::Address {
        RbacStorage::role_index_to_account(env, role, index).unwrap_or_panic(env, RbacError::IndexOutOfBounds)
    }

    /// Returns all roles that currently have at least one member.
    /// Defaults to empty vector if no roles exist.
    ///
    /// # Notes
    ///
    /// This function returns all roles that currently have at least one member.
    /// The maximum number of roles is limited by [`MAX_ROLES`].
    fn get_existing_roles(env: &soroban_sdk::Env) -> soroban_sdk::Vec<soroban_sdk::Symbol> {
        RbacStorage::existing_roles(env)
    }
}

// ===========================================================================
// Public helpers
// ===========================================================================

/// Ensures the caller has the specified role.
///
/// When `role` matches [`AUTHORIZER`], verifies that `caller` is the contract's
/// authorizer (via [`Auth::authorizer`]) instead of checking RBAC storage.
///
/// # Arguments
/// * `role` - The role to check the caller for.
/// * `caller` - The account that is being checked. Must have the role.
///
/// # Errors
/// * `Unauthorized` - If the caller does not have the role (or is not the authorizer).
pub fn ensure_role<T: RoleBasedAccessControl>(env: &Env, role: &Symbol, caller: &Address) {
    if *role == Symbol::new(env, AUTHORIZER) {
        assert_with_error!(env, T::authorizer(env).as_ref() == Some(caller), RbacError::Unauthorized);
    } else {
        assert_with_error!(env, T::has_role(env, caller, role).is_some(), RbacError::Unauthorized);
    }
}

/// Grants a role to an account without auth check.
///
/// # Arguments
/// * `account` - The account to grant the role to.
/// * `role` - The role to grant.
/// * `caller` - The account that is granting the role. Must be owner or have the role's admin role.
///
/// # Security Warning
///
/// **IMPORTANT**: This function bypasses authorization checks and should only
/// be used:
/// - During contract initialization/construction
/// - In admin functions that implement their own authorization logic
///
/// Using this function in public-facing methods creates significant security
/// risks as it could allow unauthorized role assignments.
pub fn grant_role_no_auth(env: &Env, account: &Address, role: &Symbol, caller: &Address) {
    if RbacStorage::has_role_account_to_index(env, role, account) {
        return;
    }
    add_to_role_enumeration(env, account, role);
    RoleGranted { role: role.clone(), account: account.clone(), caller: caller.clone() }.publish(env);
}

/// Revokes a role from an account without auth check.
///
/// # Arguments
/// * `account` - The account to revoke the role from.
/// * `role` - The role to revoke.
/// * `caller` - The account that is revoking the role. Must be owner or have the role's admin role.
///
/// # Security Warning
///
/// **IMPORTANT**: This function bypasses authorization checks and should only
/// be used:
/// - During contract initialization/construction
/// - In admin functions that implement their own authorization logic
///
/// Using this function in public-facing methods creates significant security
/// risks as it could allow unauthorized role revocations.
pub fn revoke_role_no_auth(env: &Env, account: &Address, role: &Symbol, caller: &Address) {
    assert_with_error!(env, RbacStorage::has_role_account_to_index(env, role, account), RbacError::RoleNotHeld);
    remove_from_role_enumeration(env, account, role);
    RoleRevoked { role: role.clone(), account: account.clone(), caller: caller.clone() }.publish(env);
}

/// Sets the admin role for a role without auth check. For constructor/init or when caller enforces own auth.
///
/// # Arguments
/// * `role` - The role to set the admin for.
/// * `admin_role` - The admin role to set for the role.
///
/// # Security Warning
///
/// **IMPORTANT**: This function bypasses authorization checks and should only
/// be used:
/// - During contract initialization/construction
/// - In admin functions that implement their own authorization logic
///
/// Using this function in public-facing methods creates significant security
/// risks as it could allow unauthorized admin role assignments.
///
/// # Circular Admin Warning
///
/// **CAUTION**: This function allows the creation of circular admin
/// relationships between roles. For example, it's possible to assign MINT_ADMIN
/// as the admin of MINT_ROLE while also making MINT_ROLE the admin of
/// MINT_ADMIN. Such circular relationships can lead to unintended consequences,
/// including:
///
/// - Race conditions where each role can revoke the other
/// - Potential security vulnerabilities in role management
/// - Confusing governance structures that are difficult to reason about
///
/// When designing your role hierarchy, carefully consider the relationships
/// between roles and avoid creating circular dependencies.
pub fn set_role_admin_no_auth(env: &Env, role: &Symbol, admin_role: &Symbol) {
    let previous = RbacStorage::role_admin(env, role);
    RbacStorage::set_role_admin(env, role, admin_role);
    RoleAdminChanged { role: role.clone(), previous_admin_role: previous, new_admin_role: Some(admin_role.clone()) }
        .publish(env);
}

/// Removes the admin role for a specified role without auth check.
///
/// For use in admin functions that implement their own authorization logic,
/// or when cleaning up unused roles.
///
/// # Arguments
/// * `role` - The role to remove the admin for.
///
/// # Errors
/// * `RbacError::AdminRoleNotFound` - If no admin role is set for the role.
///
/// # Security Warning
///
/// **IMPORTANT**: This function bypasses authorization checks and should only
/// be used:
/// - In admin functions that implement their own authorization logic
/// - When cleaning up unused roles
pub fn remove_role_admin_no_auth(env: &Env, role: &Symbol) {
    let previous = RbacStorage::role_admin(env, role);
    assert_with_error!(env, previous.is_some(), RbacError::AdminRoleNotFound);
    RbacStorage::remove_role_admin(env, role);
    RoleAdminChanged { role: role.clone(), previous_admin_role: previous, new_admin_role: None }.publish(env);
}

// ===========================================================================
// Private helpers
// ===========================================================================

/// Ensures the caller is the authorizer or has the role's admin role.
///
/// # Arguments
/// * `role` - The role to check the caller for.
/// * `caller` - The account that is being checked. Must be the authorizer or have the role's admin role.
///
/// # Errors
/// * `Unauthorized` - If the caller is neither the authorizer nor has the role's admin role.
fn ensure_if_authorizer_or_role_admin<T: RoleBasedAccessControl>(env: &Env, role: &Symbol, caller: &Address) {
    assert_with_error!(
        env,
        T::get_role_admin(env, role).is_some_and(|admin_role| T::has_role(env, caller, &admin_role).is_some())
            || Some(caller) == T::authorizer(env).as_ref(),
        RbacError::Unauthorized
    );
}

/// Adds an account to the role enumeration.
///
/// # Arguments
/// * `account` - The account to add to the role enumeration.
/// * `role` - The role to add the account to.
fn add_to_role_enumeration(env: &Env, account: &Address, role: &Symbol) {
    let count = RbacStorage::role_accounts_count(env, role);

    // If the role has no accounts, add it to the existing roles
    if count == 0 {
        let mut existing = RbacStorage::existing_roles(env);
        assert_with_error!(env, existing.len() < MAX_ROLES, RbacError::MaxRolesExceeded);
        existing.push_back(role.clone());
        RbacStorage::set_existing_roles(env, &existing);
    }

    RbacStorage::set_role_index_to_account(env, role, count, account);
    RbacStorage::set_role_account_to_index(env, role, account, &count);
    RbacStorage::set_role_accounts_count(env, role, &(count + 1));
}

/// Removes an account from the role enumeration.
///
/// # Arguments
/// * `account` - The account to remove from the role enumeration.
/// * `role` - The role to remove the account from.
fn remove_from_role_enumeration(env: &Env, account: &Address, role: &Symbol) {
    let count = RbacStorage::role_accounts_count(env, role);
    assert_with_error!(env, count > 0, RbacError::RoleIsEmpty);

    // Get the index of the account to remove
    let to_remove_idx =
        RbacStorage::role_account_to_index(env, role, account).unwrap_or_panic(env, RbacError::RoleNotHeld);

    // Get the index of the last account for the role
    let last_idx = count - 1;

    // Remove the target account's mappings
    RbacStorage::remove_role_index_to_account(env, role, to_remove_idx);
    RbacStorage::remove_role_account_to_index(env, role, account);

    // If the removed account wasn't the last, move the last account into the vacated slot
    if to_remove_idx != last_idx {
        // Get the last account and remove the mapping from index to account
        let last_account =
            RbacStorage::role_index_to_account(env, role, last_idx).unwrap_or_panic(env, RbacError::IndexOutOfBounds);
        RbacStorage::remove_role_index_to_account(env, role, last_idx);

        // Move the last account into the vacated slot
        RbacStorage::set_role_index_to_account(env, role, to_remove_idx, &last_account);
        RbacStorage::set_role_account_to_index(env, role, &last_account, &to_remove_idx);
    }

    RbacStorage::set_role_accounts_count(env, role, &last_idx);

    // If this was the last account with this role, remove the role from the existing roles
    if last_idx == 0 {
        let mut existing = RbacStorage::existing_roles(env);
        let pos = existing.first_index_of(role).unwrap_or_panic(env, RbacError::RoleNotFound);
        existing.remove(pos);
        RbacStorage::set_existing_roles(env, &existing);
    }
}
