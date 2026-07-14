//! OFT mode implementations.
//!
//! This module provides reference implementations for the two main OFT types:
//!
//! - **LockUnlock**: Locks tokens on send, unlocks on receive. Operates directly on the
//!   token via standard SEP-41 `transfer`.
//! - **MintBurn**: Burns tokens on send (via TokenClient on the token), mints on receive
//!   via a contract that implements [`Mintable`](crate::interfaces::Mintable).

use soroban_sdk::{contracttype, Address};

pub mod lock_unlock;
pub mod mint_burn;

/// The OFT operation type.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OftType {
    /// Lock tokens on send, unlock on receive.
    LockUnlock,
    /// Burn tokens on send, mint on receive.
    /// The address is the Mintable contract used for minting on credit
    MintBurn(Address),
}
