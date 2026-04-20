//! Base authorization trait for owner-protected operations.
//!
//! The `Auth` trait provides a common interface for authorization that can be
//! implemented by different access control patterns (e.g., single owner, multisig).

use crate::{errors::AuthError, option_ext::OptionExt};
use soroban_sdk::{contractclient, Address, Env};

// ===========================================================================
// Auth trait
// ===========================================================================

/// Base trait for authorization.
///
/// Provides the authorizer address for owner-protected operations. This trait
/// is implemented by both `Ownable` (external owner) and `MultiSig` (self-owning).
#[contractclient(name = "AuthClient")]
pub trait Auth: Sized {
    /// Returns the address that authorizes owner-protected operations.
    ///
    /// For `Ownable` contracts, this returns the stored owner address.
    /// For `MultiSig` contracts, this returns the contract's own address
    /// (self-owning pattern).
    ///
    /// Returns `None` when there is no authorizer (for example, when an Ownable
    /// contract's owner has been renounced).
    fn authorizer(env: &Env) -> Option<Address>;
}

// ===========================================================================
// Auth helper functions
// ===========================================================================

/// Enforces authorization from the authorizer and returns the authorizer address.
///
/// Panics if the authorizer has not provided authorization for this invocation.
pub fn enforce_auth<T: Auth>(env: &Env) -> Address {
    let authorizer = T::authorizer(env).unwrap_or_panic(env, AuthError::AuthorizerNotFound);
    authorizer.require_auth();
    authorizer
}

/// Requires authorization from the authorizer.
///
/// Panics if the authorizer has not provided authorization for this invocation.
pub fn require_auth<T: Auth>(env: &Env) {
    let _ = enforce_auth::<T>(env);
}
