use common_macros::{contract_error, contract_trait, only_role, storage};
use soroban_sdk::{assert_with_error, contractevent, Env};
use utils::rbac::RoleBasedAccessControl;

/// Role for pausing the contract.
pub const PAUSER_ROLE: &str = "PAUSER_ROLE";

/// Role for unpausing the contract.
pub const UNPAUSER_ROLE: &str = "UNPAUSER_ROLE";

// =========================================================================
// Storage
// =========================================================================

#[storage]
pub enum OFTPausableStorage {
    #[instance(bool)]
    Paused,
}

// =========================================================================
// Errors
// =========================================================================

#[contract_error]
pub enum OFTPausableError {
    Paused = 3110,
    PauseStatusUnchanged,
}

// =========================================================================
// Events
// =========================================================================

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PausedSet {
    pub paused: bool,
}

// =========================================================================
// Trait With Default Implementations
// =========================================================================

#[contract_trait]
pub trait OFTPausable: OFTPausableInternal + RoleBasedAccessControl {
    // =========================================================================
    // Management Functions
    // =========================================================================

    /// Pauses the OFT. When paused, the OFT will reject new send/receive/quote_send/quote_oft operations.
    ///
    /// # Arguments
    /// * `operator` - The address that must have PAUSER_ROLE
    #[only_role(operator, PAUSER_ROLE)]
    fn pause(env: &soroban_sdk::Env, operator: &soroban_sdk::Address) {
        Self::__set_paused(env, true);
    }

    /// Unpauses the OFT.
    ///
    /// # Arguments
    /// * `operator` - The address that must have UNPAUSER_ROLE
    #[only_role(operator, UNPAUSER_ROLE)]
    fn unpause(env: &soroban_sdk::Env, operator: &soroban_sdk::Address) {
        Self::__set_paused(env, false);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// Returns the paused state of the OFT.
    fn is_paused(env: &soroban_sdk::Env) -> bool {
        Self::__is_paused(env)
    }
}

/// Internal trait for pausable operations used by OFT hooks.
/// Contains only truly internal methods that are called from OFTPausable implementations.
pub trait OFTPausableInternal {
    // =========================================================================
    // OFT Hooks
    // =========================================================================

    /// Asserts that the OFT is not paused, panics otherwise.
    /// Used internally by `send`, `quote_send`, `quote_oft`, and `__lz_receive` to enforce pause state.
    ///
    /// # Errors
    /// * `Paused` - If the OFT is currently paused.
    fn __assert_not_paused(env: &Env) {
        assert_with_error!(env, !Self::__is_paused(env), OFTPausableError::Paused);
    }

    // =========================================================================
    // Management Functions
    // =========================================================================

    /// Sets the paused state of the OFT.
    ///
    /// When paused, the OFT will reject new send/receive/quote_send/quote_oft operations.
    ///
    /// # Arguments
    /// * `paused` - `true` to pause, `false` to unpause
    fn __set_paused(env: &Env, paused: bool) {
        assert_with_error!(env, Self::__is_paused(env) != paused, OFTPausableError::PauseStatusUnchanged);
        OFTPausableStorage::set_or_remove_paused(env, if paused { &Some(true) } else { &None });
        PausedSet { paused }.publish(env);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /// Returns the paused state of the OFT.
    fn __is_paused(env: &Env) -> bool {
        OFTPausableStorage::has_paused(env)
    }
}
