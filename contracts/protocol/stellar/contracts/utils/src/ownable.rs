use crate::{self as utils, auth::Auth, errors::OwnableError, option_ext::OptionExt};
use common_macros::{contract_trait, storage};
use soroban_sdk::{assert_with_error, contractevent, Address, Env};

// ===========================================================================
// Ownable events
// ===========================================================================

/// Event emitted when ownership is transferred (both single-step and two-step completion).
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnershipTransferred {
    pub old_owner: Address,
    pub new_owner: Address,
}

/// Event emitted when a 2-step ownership transfer is proposed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnershipTransferring {
    pub old_owner: Address,
    pub new_owner: Address,
    pub ttl: u32,
}

/// Event emitted when a 2-step ownership transfer is cancelled.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnershipTransferCancelled {
    pub owner: Address,
    pub cancelled_pending_owner: Address,
}

/// Event emitted when ownership is renounced.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OwnershipRenounced {
    pub old_owner: Address,
}

// ===========================================================================
// Ownable storage for default implementation
// ===========================================================================

/// Storage keys for Ownable.
#[storage]
pub enum OwnableStorage {
    #[instance(Address)]
    Owner,
    /// Pending owner for 2-step transfer. Stored in temporary storage with TTL -
    /// automatically expires if not accepted in time.
    #[temporary(Address)]
    PendingOwner,
}

// ===========================================================================
// Ownable trait with default implementation
// ===========================================================================

/// Trait for contracts with single-owner access control.
///
/// Extends `Auth` to provide owner-based authorization. The `Auth::authorizer()`
/// implementation should return the owner address for Ownable contracts.
///
/// Supports both single-step and two-step ownership transfer:
/// - Single-step: `transfer_ownership` - Immediate transfer (use with caution)
/// - Two-step: `begin_ownership_transfer` + `accept_ownership` - Safer, requires new owner to accept
#[contract_trait]
pub trait Ownable: Auth {
    // ===========================================================================
    // View functions
    // ===========================================================================

    /// Returns the current owner address, or None if no owner is set.
    fn owner(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
        OwnableStorage::owner(env)
    }

    /// Returns the pending owner address for 2-step transfer, or None if no transfer is pending.
    fn pending_owner(env: &soroban_sdk::Env) -> Option<soroban_sdk::Address> {
        OwnableStorage::pending_owner(env)
    }

    // ===========================================================================
    // Single-step transfer (immediate)
    // ===========================================================================

    /// Transfers ownership immediately to a new address.
    ///
    /// Use with caution - if you transfer to a wrong address, ownership is lost forever.
    /// Consider using `begin_ownership_transfer` instead.
    ///
    /// # Panics
    /// - `OwnerNotSet` if no owner is currently set
    /// - `TransferInProgress` if a 2-step transfer is in progress
    fn transfer_ownership(env: &soroban_sdk::Env, new_owner: &soroban_sdk::Address) {
        let old_owner = enforce_owner_auth::<Self>(env);
        assert_no_pending_transfer::<Self>(env);

        OwnableStorage::set_owner(env, new_owner);
        OwnershipTransferred { old_owner, new_owner: new_owner.clone() }.publish(env);
    }

    // ===========================================================================
    // Two-step transfer (safer)
    // ===========================================================================

    /// Begins an ownership transfer to a new address.
    ///
    /// The new owner must call `accept_ownership()` within `ttl` ledgers
    /// to complete the transfer. The pending transfer will automatically expire after.
    ///
    /// # Arguments
    /// - `new_owner` - The proposed new owner
    /// - `ttl` - Number of ledgers the new owner has to accept.
    ///   Use `0` to cancel a pending transfer (new_owner must match pending).
    ///
    /// # Panics
    /// - `OwnerNotSet` if no owner is currently set
    /// - `NoPendingTransfer` when cancelling and no pending transfer exists
    /// - `InvalidTtl` if ttl exceeds max TTL
    /// - `InvalidPendingOwner` when cancelling with wrong new_owner address
    fn begin_ownership_transfer(env: &soroban_sdk::Env, new_owner: &soroban_sdk::Address, ttl: u32) {
        let old_owner = enforce_owner_auth::<Self>(env);

        // Cancel case: ttl == 0
        if ttl == 0 {
            let pending = Self::pending_owner(env).unwrap_or_panic(env, OwnableError::NoPendingTransfer);

            // Verify new_owner matches pending (prevents accidental cancellation)
            assert_with_error!(env, pending == *new_owner, OwnableError::InvalidPendingOwner);

            OwnableStorage::remove_pending_owner(env);
            OwnershipTransferCancelled { owner: old_owner, cancelled_pending_owner: pending }.publish(env);
            return;
        }

        // Initiate case: validate ttl
        assert_with_error!(env, ttl <= env.storage().max_ttl(), OwnableError::InvalidTtl);

        // Store pending owner with TTL
        OwnableStorage::set_pending_owner(env, new_owner);
        OwnableStorage::extend_pending_owner_ttl(env, ttl, ttl);

        OwnershipTransferring { old_owner, new_owner: new_owner.clone(), ttl }.publish(env);
    }

    /// Accepts a pending 2-step ownership transfer.
    ///
    /// Must be called by the pending owner before the TTL expires.
    ///
    /// # Panics
    /// - `NoPendingTransfer` if there is no pending transfer (or it expired)
    fn accept_ownership(env: &soroban_sdk::Env) {
        let new_owner = Self::pending_owner(env).unwrap_or_panic(env, OwnableError::NoPendingTransfer);

        // Require authorization from the pending owner
        new_owner.require_auth();

        // Safe to unwrap: owner must exist if pending_owner exists because:
        // 1. pending_owner can only be set via begin_ownership_transfer, which requires owner auth
        // 2. renounce_ownership is blocked while a 2-step transfer is in progress
        let old_owner = OwnableStorage::owner(env).unwrap();

        // Transfer ownership
        OwnableStorage::remove_pending_owner(env);
        OwnableStorage::set_owner(env, &new_owner);

        OwnershipTransferred { old_owner, new_owner }.publish(env);
    }

    // ===========================================================================
    // Renounce
    // ===========================================================================

    /// Permanently renounces ownership.
    ///
    /// # Panics
    /// - `OwnerNotSet` if no owner is currently set
    /// - `TransferInProgress` if a 2-step transfer is in progress (cancel it first)
    fn renounce_ownership(env: &soroban_sdk::Env) {
        let old_owner = enforce_owner_auth::<Self>(env);
        assert_no_pending_transfer::<Self>(env);

        OwnableStorage::remove_owner(env);
        OwnershipRenounced { old_owner }.publish(env);
    }
}

/// Trait for initializing the owner of the contract.
pub trait OwnableInitializer {
    /// Initializes the owner of the contract.
    ///
    /// # Critical: constructor-only, never expose as a public entrypoint
    ///
    /// `init_owner` must **ONLY** be called from the contract constructor. Do not expose it
    /// as a public function under the assumption that it will "simply fail" after initialization.
    ///
    /// After `renounce_ownership`, the owner is removed and `has_owner` returns false. If
    /// `init_owner` were exposed publicly, anyone could call it post-renounce and become the
    /// new owner, effectively undoing the renunciation. Always keep this logic internal to
    /// the constructor.
    fn init_owner(env: &Env, owner: &Address) {
        assert_with_error!(env, !OwnableStorage::has_owner(env), OwnableError::OwnerAlreadySet);
        OwnableStorage::set_owner(env, owner);
    }
}

// ===========================================================================
// Ownable helper functions
// ===========================================================================

/// Enforces owner authorization and returns the owner address.
/// Panics if no owner is set or authorization fails.
pub fn enforce_owner_auth<T: Ownable>(env: &Env) -> Address {
    let owner = T::owner(env).unwrap_or_panic(env, OwnableError::OwnerNotSet);
    // Ensure the owner is the same as the authorizer
    assert_with_error!(env, Some(&owner) == T::authorizer(env).as_ref(), OwnableError::InvalidAuthorizer);
    owner.require_auth();
    owner
}

/// Asserts that no 2-step ownership transfer is in progress.
/// Panics with `TransferInProgress` if a pending transfer exists.
fn assert_no_pending_transfer<T: Ownable>(env: &Env) {
    assert_with_error!(env, T::pending_owner(env).is_none(), OwnableError::TransferInProgress);
}
